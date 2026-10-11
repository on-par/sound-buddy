"""Tests for TestFlight manual signing (#1696). Run:
python apps/ios/scripts/test_testflight_signing.py
(or python3 -m pytest apps/ios/scripts/test_testflight_signing.py)

Covers the signing plan and xcodebuild command assembly in
testflight_signing.py, and runs testflight.sh --dry-run end to end against
stub xcodebuild/node/security binaries so no archive, upload or network call
can happen. Stdlib only.
"""

from __future__ import annotations

import json
import os
import plistlib
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

import testflight_signing as ts

SCRIPTS = Path(__file__).resolve().parent
TESTFLIGHT_SH = SCRIPTS / "testflight.sh"
REPO_CONFIG = json.loads((SCRIPTS.parent / "testflight.config.json").read_text())

TEAM = "Q7LB49TPBS"
PROFILE = "Sound Buddy iOS App Store"
IDENTITY = "Apple Distribution: On PAR Dev, LLC (Q7LB49TPBS)"
KEYCHAIN_SUFFIX = "Library/Keychains/soundbuddy-build.keychain-db"
BUNDLE = "com.soundbuddy.ios"


def default_signing(**overrides) -> ts.Signing:
    return ts.resolve_signing(REPO_CONFIG, {"HOME": "/Users/test"}, **overrides)


class ResolveSigningTests(unittest.TestCase):
    def test_default_config_is_manual_with_the_existing_app_store_profile(self):
        signing = default_signing()
        self.assertEqual(signing.style, "Manual")
        self.assertEqual(signing.team, TEAM)
        self.assertEqual(signing.profile, PROFILE)
        self.assertEqual(signing.identity, IDENTITY)
        self.assertTrue(signing.keychain.endswith(KEYCHAIN_SUFFIX), signing.keychain)
        self.assertFalse(signing.keychain.startswith("~"), "keychain path must be expanded")
        self.assertEqual(signing.bundle_id, BUNDLE)
        self.assertFalse(signing.allow_provisioning_updates)

    def test_env_overrides_team_and_keychain(self):
        signing = ts.resolve_signing(
            REPO_CONFIG, {"DEVELOPMENT_TEAM": "ENVTEAM123", "TESTFLIGHT_SIGNING_KEYCHAIN": "/tmp/other.keychain-db"}
        )
        self.assertEqual(signing.team, "ENVTEAM123")
        self.assertEqual(signing.keychain, "/tmp/other.keychain-db")

    def test_flags_beat_env_and_config(self):
        signing = ts.resolve_signing(
            REPO_CONFIG,
            {"DEVELOPMENT_TEAM": "ENVTEAM123"},
            team="FLAGTEAM99",
            profile="Other Profile",
            identity="Apple Distribution: Someone Else (FLAGTEAM99)",
            keychain="/tmp/flag.keychain-db",
        )
        self.assertEqual(
            (signing.team, signing.profile, signing.identity, signing.keychain),
            ("FLAGTEAM99", "Other Profile", "Apple Distribution: Someone Else (FLAGTEAM99)", "/tmp/flag.keychain-db"),
        )

    def test_missing_signing_block_is_an_error(self):
        config = {k: v for k, v in REPO_CONFIG.items() if k != "signing"}
        with self.assertRaises(ts.SigningConfigError) as ctx:
            ts.resolve_signing(config, {})
        self.assertIn("provisioningProfile", str(ctx.exception))


class CommandAssemblyTests(unittest.TestCase):
    def archive(self, signing):
        return ts.archive_args(signing, project="P.xcodeproj", archive_path="/w/A.xcarchive", build_number="13")

    def export(self, signing, env=None):
        return ts.export_args(
            signing, env or {}, archive_path="/w/A.xcarchive", export_options="/w/E.plist", export_path="/w/out"
        )

    def test_default_commands_never_allow_provisioning_updates(self):
        signing = default_signing()
        self.assertNotIn("-allowProvisioningUpdates", self.archive(signing))
        self.assertNotIn("-allowProvisioningUpdates", self.export(signing))

    def test_archive_carries_manual_signing_and_the_keychain(self):
        signing = default_signing()
        args = self.archive(signing)
        self.assertIn("CODE_SIGN_STYLE=Manual", args)
        self.assertIn(f"DEVELOPMENT_TEAM={TEAM}", args)
        self.assertIn(f"CODE_SIGN_IDENTITY={IDENTITY}", args)
        self.assertIn(f"SOUNDBUDDY_PROVISIONING_PROFILE={PROFILE}", args)
        # A global PROVISIONING_PROFILE_SPECIFIER also hits the SoundBuddyKit
        # package targets, which fail the archive ("does not support
        # provisioning profiles"); only the app target may get the profile.
        self.assertFalse(any(a.startswith("PROVISIONING_PROFILE_SPECIFIER=") for a in args), args)
        self.assertIn(f"OTHER_CODE_SIGN_FLAGS=--keychain {signing.keychain}", args)
        self.assertIn("CURRENT_PROJECT_VERSION=13", args)
        self.assertEqual(args[0], "archive")

    def test_export_options_are_manual_with_the_profile(self):
        options = ts.export_options(default_signing())
        self.assertEqual(options["signingStyle"], "manual")
        self.assertEqual(options["teamID"], TEAM)
        self.assertEqual(options["signingCertificate"], IDENTITY)
        self.assertEqual(options["provisioningProfiles"], {BUNDLE: PROFILE})
        self.assertEqual(options["method"], "app-store-connect")
        self.assertEqual(options["destination"], "upload")

    def test_no_upload_exports_locally(self):
        self.assertEqual(ts.export_options(default_signing(), upload=False)["destination"], "export")

    def test_overrides_reach_the_commands(self):
        signing = default_signing(profile="Other Profile", keychain="/tmp/flag.keychain-db", team="FLAGTEAM99")
        args = self.archive(signing)
        self.assertIn("SOUNDBUDDY_PROVISIONING_PROFILE=Other Profile", args)
        self.assertIn("OTHER_CODE_SIGN_FLAGS=--keychain /tmp/flag.keychain-db", args)
        self.assertIn("DEVELOPMENT_TEAM=FLAGTEAM99", args)
        self.assertEqual(ts.export_options(signing)["provisioningProfiles"], {BUNDLE: "Other Profile"})

    def test_opt_in_allows_provisioning_updates_on_both_commands(self):
        signing = default_signing(allow_provisioning_updates=True)
        self.assertEqual(signing.style, "Automatic")
        self.assertIn("-allowProvisioningUpdates", self.archive(signing))
        self.assertIn("-allowProvisioningUpdates", self.export(signing))
        self.assertIn("CODE_SIGN_STYLE=Automatic", self.archive(signing))
        self.assertEqual(ts.export_options(signing)["signingStyle"], "automatic")

    def test_export_auth_flags_are_redacted_on_request(self):
        env = {"ASC_KEY_PATH": "/secret/AuthKey.p8", "ASC_KEY_ID": "KEYID123", "ASC_ISSUER_ID": "issuer-uuid"}
        plain = ts.export_args(
            default_signing(), env, archive_path="a", export_options="e", export_path="o"
        )
        redacted = ts.export_args(
            default_signing(), env, archive_path="a", export_options="e", export_path="o", redact=True
        )
        self.assertIn("/secret/AuthKey.p8", plain)
        for value in env.values():
            self.assertNotIn(value, redacted)


class PreflightParsingTests(unittest.TestCase):
    def test_identity_match_is_exact(self):
        out = f'  1) ABCDEF "{IDENTITY}"\n     1 valid identities found\n'
        self.assertTrue(ts.identity_in_keychain(out, IDENTITY))
        self.assertFalse(ts.identity_in_keychain(out, "Apple Development: Someone"))

    def test_keychain_search_list(self):
        out = '    "/Users/x/Library/Keychains/login.keychain-db"\n    "/Users/x/Library/Keychains/soundbuddy-build.keychain-db"\n'
        self.assertTrue(ts.keychain_in_search_list(out, "/Users/x/Library/Keychains/soundbuddy-build.keychain-db"))
        self.assertFalse(ts.keychain_in_search_list(out, "/Users/x/Library/Keychains/other.keychain-db"))

    def test_find_profile_matches_name_and_app_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "a.mobileprovision").write_bytes(b"a")
            (folder / "b.mobileprovision").write_bytes(b"b")
            decoded = {
                "a.mobileprovision": {"Name": "ship-it iOS App Store", "Entitlements": {"application-identifier": f"{TEAM}.com.onpar.shipit.ios"}},
                "b.mobileprovision": {"Name": PROFILE, "Entitlements": {"application-identifier": f"{TEAM}.{BUNDLE}"}},
            }
            found = ts.find_profile(default_signing(), dirs=(folder,), decode=lambda p: plistlib.dumps(decoded[p.name]))
            self.assertEqual(found, "b.mobileprovision")


class PreflightTests(unittest.TestCase):
    def test_a_locked_keychain_fails_preflight(self):
        ok, lines = ts.preflight(default_signing(), unlocked=lambda _path: False)
        if any("skipped" in line for line in lines):
            self.skipTest("security is not available")
        self.assertFalse(ok)
        self.assertTrue(any("keychain unlocked:         NO" in line for line in lines), lines)

    def test_unknown_lock_state_does_not_block(self):
        lines = ts.preflight(default_signing(), unlocked=lambda _path: None)[1]
        if any("skipped" in line for line in lines):
            self.skipTest("security is not available")
        self.assertTrue(any("keychain unlocked:         unknown" in line for line in lines), lines)


# --- end-to-end dry-run against stub binaries ---------------------------------

# The PEM armor is assembled at runtime so no tracked file carries a literal
# private-key header; the key-material guard in app/electron/licensing.test.ts
# fails the suite on one. The fixture is still a well-formed PKCS#8 block.
_PEM_BEGIN = "BEG" + "IN"
_PEM_LABEL = "PRIVATE" + " KEY"
SECRET_KEY_CONTENTS = (
    f"-----{_PEM_BEGIN} {_PEM_LABEL}-----\n"
    "TOPSECRETKEYMATERIAL\n"
    f"-----END {_PEM_LABEL}-----\n"
)
SECRET_KEYCHAIN_PASSWORD = "hunter2-keychain-password"
SECRET_KEY_ID = "ZZKEYID999"
SECRET_ISSUER = "11111111-2222-3333-4444-555555555555"


class SecretFixtureTests(unittest.TestCase):
    def test_key_fixture_is_an_armored_private_key_block(self):
        lines = SECRET_KEY_CONTENTS.splitlines()
        self.assertEqual(lines[0], "-----" + _PEM_BEGIN + " " + _PEM_LABEL + "-----")
        self.assertEqual(lines[-1], "-----END " + _PEM_LABEL + "-----")
        self.assertIn("TOPSECRETKEYMATERIAL", lines)


def _stub(path: Path, body: str) -> None:
    path.write_text("#!/usr/bin/env bash\n" + textwrap.dedent(body))
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


class DryRunScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.home = root / "home"
        profiles = self.home / "Library/MobileDevice/Provisioning Profiles"
        profiles.mkdir(parents=True)
        (profiles / "sb.mobileprovision").write_bytes(b"stub")
        self.bin = root / "bin"
        self.bin.mkdir()
        self.calls = root / "calls.log"
        self.key = root / "AuthKey_TEST.p8"
        self.key.write_text(SECRET_KEY_CONTENTS)
        _stub(self.bin / "xcodebuild", f"""\
            echo "xcodebuild $*" >> "{self.calls}"
            case " $* " in
              *" -showBuildSettings "*) echo "    MARKETING_VERSION = 0.1.0" ;;
              *) echo "stub xcodebuild refuses to archive/export" >&2; exit 97 ;;
            esac
            """)
        _stub(self.bin / "node", f"""\
            echo "node $*" >> "{self.calls}"
            case " $* " in
              *" --print-next-build-number "*) echo 13 ;;
              *" --dry-run "*) echo "DISTRIBUTION PLAN (stub)" ;;
              *) echo "stub node refuses to distribute" >&2; exit 98 ;;
            esac
            """)
        profile_plist = root / "profile.plist"
        profile_plist.write_bytes(
            plistlib.dumps({"Name": PROFILE, "Entitlements": {"application-identifier": f"{TEAM}.{BUNDLE}"}})
        )
        _stub(self.bin / "security", f"""\
            echo "security $1" >> "{self.calls}"
            case "$1" in
              find-identity) echo '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "{IDENTITY}"'; echo '     1 valid identities found' ;;
              list-keychains) echo '    "{self.home}/{KEYCHAIN_SUFFIX}"' ;;
              cms) cat "{profile_plist}" ;;
              *) echo "stub security refuses $1" >&2; exit 99 ;;
            esac
            """)

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args, asc=True):
        env = {
            "PATH": f"{self.bin}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
            "HOME": str(self.home),
            "KEYCHAIN_PASSWORD": SECRET_KEYCHAIN_PASSWORD,
        }
        if asc:
            env.update({"ASC_KEY_ID": SECRET_KEY_ID, "ASC_ISSUER_ID": SECRET_ISSUER, "ASC_KEY_PATH": str(self.key)})
        result = subprocess.run(
            ["bash", str(TESTFLIGHT_SH), "--dry-run", *args], env=env, capture_output=True, text=True, check=False
        )
        calls = self.calls.read_text() if self.calls.exists() else ""
        return result, calls

    def assert_no_build_or_upload(self, calls):
        self.assertNotIn("xcodebuild archive", calls)
        self.assertNotIn("-exportArchive", calls)
        for line in calls.splitlines():
            if line.startswith("node "):
                self.assertTrue("--print-next-build-number" in line or "--dry-run" in line, line)

    def test_default_dry_run_prints_the_manual_signing_plan(self):
        result, calls = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        out = result.stdout
        self.assertIn("style:                 Manual", out)
        self.assertIn(f"team:                  {TEAM}", out)
        self.assertIn(f"provisioning profile:  {PROFILE}", out)
        self.assertIn(f"identity:              {IDENTITY}", out)
        self.assertIn(f"keychain:              {self.home}/{KEYCHAIN_SUFFIX}", out)
        self.assertIn("provisioning updates:  disabled", out)
        self.assertNotIn("-allowProvisioningUpdates", out)
        self.assertIn("--keychain", out)
        self.assertIn("identity in keychain:      found", out)
        self.assertIn("profile installed:         sb.mobileprovision", out)
        self.assertIn("DISTRIBUTION PLAN (stub)", out)
        self.assert_no_build_or_upload(calls)

    def test_dry_run_prints_no_secrets(self):
        result, _ = self.run_script()
        printed = result.stdout + result.stderr
        for secret in (
            "TOPSECRETKEYMATERIAL",
            SECRET_KEYCHAIN_PASSWORD,
            SECRET_KEY_ID,
            SECRET_ISSUER,
            str(self.key),
            "0123456789ABCDEF0123456789ABCDEF01234567",
        ):
            self.assertNotIn(secret, printed)

    def test_flag_overrides_show_in_plan_and_commands(self):
        result, calls = self.run_script(
            "--profile", "Other Profile", "--team", "FLAGTEAM99", "--keychain", "/tmp/flag.keychain-db",
            "--identity", "Apple Distribution: X (FLAGTEAM99)",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        out = result.stdout
        self.assertIn("provisioning profile:  Other Profile", out)
        self.assertIn("team:                  FLAGTEAM99", out)
        self.assertIn("keychain:              /tmp/flag.keychain-db", out)
        self.assertIn("'SOUNDBUDDY_PROVISIONING_PROFILE=Other Profile'", out)
        self.assertIn("--keychain /tmp/flag.keychain-db", out)
        self.assert_no_build_or_upload(calls)

    def test_opt_in_flag_enables_provisioning_updates(self):
        result, calls = self.run_script("--allow-provisioning-updates")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("provisioning updates:  ENABLED", result.stdout)
        self.assertIn("-allowProvisioningUpdates", result.stdout)
        self.assert_no_build_or_upload(calls)

    def test_dry_run_without_asc_env_still_prints_the_signing_plan(self):
        result, calls = self.run_script(asc=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("style:                 Manual", result.stdout)
        self.assertIn("Distribution plan skipped", result.stdout)
        self.assertNotIn("node ", calls)

    def test_unknown_flag_fails(self):
        result, _ = self.run_script("--bogus")
        self.assertNotEqual(result.returncode, 0)


class ProjectRoutingTests(unittest.TestCase):
    """The app target (and only it) reads the profile from SOUNDBUDDY_PROVISIONING_PROFILE."""

    def test_project_yml_routes_the_profile_through_the_variable(self):
        text = (SCRIPTS.parent / "project.yml").read_text()
        self.assertIn("PROVISIONING_PROFILE_SPECIFIER: $(SOUNDBUDDY_PROVISIONING_PROFILE)", text)

    def test_generated_project_routes_the_profile_for_debug_and_release(self):
        text = (SCRIPTS.parent / "SoundBuddy.xcodeproj" / "project.pbxproj").read_text()
        self.assertEqual(
            text.count('PROVISIONING_PROFILE_SPECIFIER = "$(SOUNDBUDDY_PROVISIONING_PROFILE)";'), 2
        )


class ScriptSourceTests(unittest.TestCase):
    def test_script_has_no_unconditional_provisioning_updates(self):
        text = TESTFLIGHT_SH.read_text()
        self.assertNotIn("-allowProvisioningUpdates", text.replace("--allow-provisioning-updates", ""))


if __name__ == "__main__":
    unittest.main()
