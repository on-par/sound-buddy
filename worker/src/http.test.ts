import { describe, expect, it } from "vitest";
import { json, html, escapeHtml } from "./http";

describe("json", () => {
  it("serializes the body as JSON with the standard content-type and status 200 by default", async () => {
    const res = json({ ok: true, count: 2 });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.text()).toBe('{"ok":true,"count":2}');
  });

  it("honors a custom status", () => {
    expect(json({ error: "boom" }, 422).status).toBe(422);
  });

  it("merges extra headers over the content-type default", () => {
    const res = json({}, 200, { "x-request-id": "req-1", "content-type": "application/json" });

    expect(res.headers.get("x-request-id")).toBe("req-1");
    expect(res.headers.get("content-type")).toBe("application/json");
  });
});

describe("html", () => {
  it("wraps the body with the html content-type and status 200 by default", async () => {
    const res = html("<p>hi</p>");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<p>hi</p>");
  });

  it("honors a custom status and merges extra headers", async () => {
    const res = html("oops", 500, { "x-request-id": "req-2" });

    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBe("req-2");
    expect(await res.text()).toBe("oops");
  });
});

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });

  it("escapes safely for an attribute context", () => {
    expect(escapeHtml(`onclick="alert('x')"`)).toBe("onclick=&quot;alert(&#39;x&#39;)&quot;");
  });
});
