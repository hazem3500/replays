# Security policy

## Supported versions

Replay Kit is pre-1.0. Security fixes land on `main` and in the latest `0.x` release.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository.
Do not open a public issue for anything exploitable. Include the version or commit, a description, and steps or a
proof of concept. You should get an acknowledgement within a few days.

## What counts

The project's security promises are listed in the README under "Privacy model". Reports are especially welcome for:

- anything that lets a recording keep a value the sanitizer promises to remove (cookies, authorization and other
  credential headers, URL credentials, sensitive query values, typed input values);
- authentication or authorization bypasses in the auth adapters, the CSRF (`Sec-Fetch-Site`) check, or the
  loopback-only render route;
- path traversal or request smuggling in the file and object storage drivers;
- script injection through recorded content, titles, source links or branding values;
- denial of service through the upload endpoint beyond the documented size limits.

Out of scope: running with `AUTH_MODE=none` on a reachable network (the README says not to), and findings that need
a malicious operator of the server.

## Handling recordings

A replay contains whatever was on the screen. Treat uploaded recordings like application logs: keep the server
behind authentication, keep retention short, and do not record production sessions of real users without a legal
basis. See "Privacy model" in the README.
