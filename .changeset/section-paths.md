---
'testrail-ai': minor
'testrail-ai-mcp': minor
'testrail-ai-cli': minor
---

Find cases by where they live. Case search takes `section_path` (`--section-path` in the CLI), such as `Checkout > Payments`, matched without case. A unique trailing part is enough, and in a project with several suites the path starts with the suite name. An unknown or ambiguous path lists the candidates. Section search shows each section's full path.
