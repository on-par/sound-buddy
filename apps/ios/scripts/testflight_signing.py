#!/usr/bin/env python3
"""Signing plan and xcodebuild argument assembly for testflight.sh (#1696).

testflight.sh used to archive with automatic signing and
-allowProvisioningUpdates, which would create new certificates and profiles
in the team. This helper makes manual signing with the existing App Store
distribution profile the default, passes the build keychain to codesign
explicitly, and only allows provisioning updates behind an explicit opt-in.

Settings resolve in this order (later wins):
  1. the "signing" block of apps/ios/testflight.config.json
  2. env: DEVELOPMENT_TEAM (team), TESTFLIGHT_SIGNING_KEYCHAIN (keychain)
  3. CLI flags: --team, --profile, --identity, --keychain,
     --allow-provisioning-updates

Subcommands (stdlib only, no network, never reads key contents):
  plan            print the human-readable signing plan
  archive-args    NUL-delimited `xcodebuild archive` arguments
  export-args     NUL-delimited `xcodebuild -exportArchive` arguments
  export-options  write the ExportOptions.plist for this signing plan
  dry-run         print the plan plus both commands, with auth values redacted
  preflight       check (read-only, via `security`) that the identity is in the
                  build keychain and the profile is installed; exit 1 if not

The ASC key path, key id and issuer id are read from the environment only
when assembling export arguments; `dry-run` prints placeholders instead.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import json
import os
import plistlib
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

IOS_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = IOS_ROOT / "testflight.config.json"
EXPORT_OPTIONS_TEMPLATE = Path(__file__).resolve().parent / "ExportOptions.plist"

ASC_AUTH_ENV = (
    ("-authenticationKeyPath", "ASC_KEY_PATH"),
    ("-authenticationKeyID", "ASC_KEY_ID"),
    ("-authenticationKeyIssuerID", "ASC_ISSUER_ID"),
)
REDACTED = "<redacted>"
# project.yml sets the app target's PROVISIONING_PROFILE_SPECIFIER to
# $(SOUNDBUDDY_PROVISIONING_PROFILE). Passing the profile through this variable
# keeps it off the SoundBuddyKit package targets, which fail the archive when a
# profile is specified for them.
PROFILE_SETTING = "SOUNDBUDDY_PROVISIONING_PROFILE"


class SigningConfigError(ValueError):
    """Raised when the signing configuration is missing or malformed."""


@dataclass(frozen=True)
class Signing:
    team: str
    profile: str
    identity: str
    keychain: str
    bundle_id: str
    allow_provisioning_updates: bool = False

    @property
    def style(self) -> str:
        return "Automatic" if self.allow_provisioning_updates else "Manual"


def _expand(path: str) -> str:
    return os.path.expanduser(os.path.expandvars(path)) if path else path


def resolve_signing(
    config: dict,
    env: dict[str, str],
    *,
    team: str | None = None,
    profile: str | None = None,
    identity: str | None = None,
    keychain: str | None = None,
    allow_provisioning_updates: bool = False,
) -> Signing:
    """Merge config, env and flag values into one Signing plan."""
    block = config.get("signing") or {}
    if not isinstance(block, dict):
        raise SigningConfigError('testflight.config.json "signing" must be an object')

    def pick(flag: str | None, env_name: str | None, key: str) -> str:
        if flag:
            return flag
        if env_name and env.get(env_name, "").strip():
            return env[env_name].strip()
        return str(block.get(key) or "").strip()

    signing = Signing(
        team=pick(team, "DEVELOPMENT_TEAM", "teamId"),
        profile=pick(profile, None, "provisioningProfile"),
        identity=pick(identity, None, "identity"),
        keychain=_expand(pick(keychain, "TESTFLIGHT_SIGNING_KEYCHAIN", "keychain")),
        bundle_id=(env.get("ASC_BUNDLE_ID", "").strip() or str(config.get("bundleId") or "")),
        allow_provisioning_updates=allow_provisioning_updates,
    )
    missing = [
        name
        for name, value in (
            ("teamId", signing.team),
            ("provisioningProfile", signing.profile),
            ("identity", signing.identity),
            ("keychain", signing.keychain),
            ("bundleId", signing.bundle_id),
        )
        if not value
    ]
    if missing:
        raise SigningConfigError(
            "signing config is missing " + ", ".join(missing)
            + ' (set them in the "signing" block of testflight.config.json or pass flags)'
        )
    return signing


def load_config(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as err:
        raise SigningConfigError(f"{path} not found") from err
    except json.JSONDecodeError as err:
        raise SigningConfigError(f"{path} is not valid JSON: {err}") from err


def signing_build_settings(signing: Signing) -> list[str]:
    """Build-setting overrides for the archive, as KEY=VALUE arguments."""
    settings = [f"DEVELOPMENT_TEAM={signing.team}"]
    if signing.allow_provisioning_updates:
        settings.append("CODE_SIGN_STYLE=Automatic")
    else:
        settings += [
            "CODE_SIGN_STYLE=Manual",
            f"CODE_SIGN_IDENTITY={signing.identity}",
            f"{PROFILE_SETTING}={signing.profile}",
        ]
    settings.append(f"OTHER_CODE_SIGN_FLAGS=--keychain {shlex.quote(signing.keychain)}")
    return settings


def archive_args(signing: Signing, *, project: str, archive_path: str, build_number: str) -> list[str]:
    args = [
        "archive",
        "-project", project,
        "-scheme", "SoundBuddy",
        "-configuration", "Release",
        "-destination", "generic/platform=iOS",
        "-archivePath", archive_path,
    ]
    if signing.allow_provisioning_updates:
        args.append("-allowProvisioningUpdates")
    args += signing_build_settings(signing)
    args.append(f"CURRENT_PROJECT_VERSION={build_number}")
    return args


def auth_args(env: dict[str, str], *, redact: bool) -> list[str]:
    """ASC API key flags for the upload. Values are never printed when redact is set."""
    args: list[str] = []
    for flag, name in ASC_AUTH_ENV:
        value = env.get(name, "")
        if value:
            args += [flag, REDACTED if redact else value]
    return args


def export_args(
    signing: Signing,
    env: dict[str, str],
    *,
    archive_path: str,
    export_options: str,
    export_path: str,
    redact: bool = False,
) -> list[str]:
    args = [
        "-exportArchive",
        "-archivePath", archive_path,
        "-exportOptionsPlist", export_options,
        "-exportPath", export_path,
    ]
    if signing.allow_provisioning_updates:
        args.append("-allowProvisioningUpdates")
    return args + auth_args(env, redact=redact)


def export_options(signing: Signing, *, upload: bool = True, template: Path = EXPORT_OPTIONS_TEMPLATE) -> dict:
    with template.open("rb") as handle:
        options = plistlib.load(handle)
    options["teamID"] = signing.team
    options["destination"] = "upload" if upload else "export"
    if signing.allow_provisioning_updates:
        options["signingStyle"] = "automatic"
        options.pop("provisioningProfiles", None)
        options.pop("signingCertificate", None)
    else:
        options["signingStyle"] = "manual"
        options["signingCertificate"] = signing.identity
        options["provisioningProfiles"] = {signing.bundle_id: signing.profile}
    return options


def plan_lines(signing: Signing) -> list[str]:
    updates = (
        "ENABLED (--allow-provisioning-updates: Xcode may create certificates or profiles)"
        if signing.allow_provisioning_updates
        else "disabled (no certificates or profiles are created)"
    )
    return [
        "TestFlight signing plan:",
        f"  style:                 {signing.style}",
        f"  team:                  {signing.team}",
        f"  bundle id:             {signing.bundle_id}",
        f"  provisioning profile:  {signing.profile}",
        f"  identity:              {signing.identity}",
        f"  keychain:              {signing.keychain}",
        f"  provisioning updates:  {updates}",
    ]


PROFILE_DIRS = (
    Path("~/Library/MobileDevice/Provisioning Profiles").expanduser(),
    Path("~/Library/Developer/Xcode/UserData/Provisioning Profiles").expanduser(),
)


def _run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=False, check=False)
    return result.stdout.decode("utf-8", "replace") if result.returncode == 0 else ""


def identity_in_keychain(find_identity_output: str, identity: str) -> bool:
    """True when `security find-identity -v` output lists the identity as valid."""
    return f'"{identity}"' in find_identity_output


def keychain_in_search_list(list_keychains_output: str, keychain: str) -> bool:
    wanted = os.path.realpath(keychain)
    for line in list_keychains_output.splitlines():
        path = line.strip().strip('"')
        if path and os.path.realpath(path) == wanted:
            return True
    return False


def find_profile(signing: Signing, dirs=PROFILE_DIRS, decode=None) -> str | None:
    """Return the installed profile file name matching name, team and bundle id."""
    decode = decode or (lambda path: _run(["security", "cms", "-D", "-i", str(path)]).encode())
    wanted_app_id = f"{signing.team}.{signing.bundle_id}"
    for folder in dirs:
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.mobileprovision")):
            raw = decode(path)
            if not raw:
                continue
            try:
                info = plistlib.loads(raw)
            except Exception:  # noqa: BLE001 - an unreadable profile is just not a match
                continue
            app_id = (info.get("Entitlements") or {}).get("application-identifier")
            if info.get("Name") == signing.profile and app_id == wanted_app_id:
                return path.name
    return None


KEYCHAIN_UNLOCKED_BIT = 1  # kSecUnlockStateStatus


def keychain_unlocked(path: str) -> bool | None:
    """Lock state via SecKeychainGetStatus, which never prompts. None when unknown.

    A locked build keychain makes codesign wait forever on a password prompt
    that nobody on the Mini will answer, so the real run refuses to start.
    """
    name = ctypes.util.find_library("Security")
    if not name or not os.path.exists(path):
        return None
    try:
        security = ctypes.cdll.LoadLibrary(name)
        keychain = ctypes.c_void_p()
        if security.SecKeychainOpen(ctypes.c_char_p(path.encode()), ctypes.byref(keychain)) != 0:
            return None
        status = ctypes.c_uint32()
        if security.SecKeychainGetStatus(keychain, ctypes.byref(status)) != 0:
            return None
        return bool(status.value & KEYCHAIN_UNLOCKED_BIT)
    except (OSError, AttributeError):
        return None


def preflight(signing: Signing, unlocked=keychain_unlocked) -> tuple[bool, list[str]]:
    """Read-only signing checks. Never prints certificate hashes or secrets."""
    if shutil.which("security") is None:
        return True, ["Preflight skipped: `security` is not available (not macOS)."]
    identity_ok = identity_in_keychain(
        _run(["security", "find-identity", "-v", "-p", "codesigning", signing.keychain]), signing.identity
    )
    search_ok = keychain_in_search_list(_run(["security", "list-keychains", "-d", "user"]), signing.keychain)
    profile = find_profile(signing)
    lock_state = unlocked(signing.keychain)
    lock_text = {
        True: "yes",
        False: "NO (locked: codesign would hang on a password prompt; unlock it first, this script never does)",
        None: "unknown",
    }[lock_state]
    lines = [
        "Signing preflight (read-only):",
        f"  identity in keychain:      {'found' if identity_ok else 'NOT FOUND'}",
        f"  keychain in search list:   {'yes' if search_ok else 'no (export re-signs from the search list; add it with security list-keychains -d user -s ...)'}",
        f"  profile installed:         {profile if profile else 'NOT FOUND'}",
        f"  keychain unlocked:         {lock_text}",
    ]
    return identity_ok and profile is not None and lock_state is not False, lines


def render_command(args: list[str]) -> str:
    return "xcodebuild " + " ".join(shlex.quote(arg) for arg in args)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["plan", "archive-args", "export-args", "export-options", "dry-run", "preflight"])
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--team")
    parser.add_argument("--profile")
    parser.add_argument("--identity")
    parser.add_argument("--keychain")
    parser.add_argument("--allow-provisioning-updates", action="store_true")
    parser.add_argument("--project", default=str(IOS_ROOT / "SoundBuddy.xcodeproj"))
    parser.add_argument("--archive-path", default="<work>/SoundBuddy.xcarchive")
    parser.add_argument("--export-options-path", default="<work>/ExportOptions.plist")
    parser.add_argument("--export-path", default="<work>/export")
    parser.add_argument("--build-number", default="<build>")
    parser.add_argument("--no-upload", action="store_true", help="export locally instead of uploading")
    parser.add_argument("--out", help="export-options: where to write the plist")
    return parser


def _emit_nul(args: list[str]) -> None:
    sys.stdout.write("".join(arg + "\0" for arg in args))


def main(argv: list[str] | None = None, env: dict[str, str] | None = None) -> int:
    opts = _parser().parse_args(argv)
    env = dict(os.environ if env is None else env)
    try:
        signing = resolve_signing(
            load_config(Path(opts.config)),
            env,
            team=opts.team,
            profile=opts.profile,
            identity=opts.identity,
            keychain=opts.keychain,
            allow_provisioning_updates=opts.allow_provisioning_updates,
        )
    except SigningConfigError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2

    archive = archive_args(
        signing, project=opts.project, archive_path=opts.archive_path, build_number=opts.build_number
    )

    def export(redact: bool) -> list[str]:
        return export_args(
            signing,
            env,
            archive_path=opts.archive_path,
            export_options=opts.export_options_path,
            export_path=opts.export_path,
            redact=redact,
        )

    if opts.command == "preflight":
        ok, lines = preflight(signing)
        print("\n".join(lines))
        return 0 if ok else 1
    if opts.command == "plan":
        print("\n".join(plan_lines(signing)))
    elif opts.command == "archive-args":
        _emit_nul(archive)
    elif opts.command == "export-args":
        _emit_nul(export(redact=False))
    elif opts.command == "export-options":
        if not opts.out:
            print("error: export-options needs --out PATH", file=sys.stderr)
            return 2
        with open(opts.out, "wb") as handle:
            plistlib.dump(export_options(signing, upload=not opts.no_upload), handle)
    else:
        options = export_options(signing, upload=not opts.no_upload)
        print("\n".join(plan_lines(signing)))
        print("")
        print("Archive command (not run):")
        print("  " + render_command(archive))
        print("")
        print("Export command (not run):")
        print("  " + render_command(export(redact=True)))
        print("")
        print("ExportOptions.plist:")
        for key in sorted(options):
            print(f"  {key}: {json.dumps(options[key])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
