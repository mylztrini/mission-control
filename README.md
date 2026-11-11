# mission-control (static loader)

Data-free page for Mission Control. Open it only with its private link (`#k=<view key>`).
The page holds no data and no keys. It calls a private API with the key in a request header.
Not for indexing: robots.txt disallows everything, and every page has noindex/no-referrer.

## Blur mode

Shift+B, or the **Blur mode** switch in the top bar, hides amounts, names, emails, phone numbers, and private text for screenshots. The choice is saved on this device (`mcBlurMode`) and starts off. Labels, navigation, and chart shapes stay readable.

To opt in on a new value, add `class="mc-sensitive"` and `data-mc-sensitive="money"` (`name`, `id`, `text`, `email`, or `phone` also work). Currency, email addresses, and phone numbers in ordinary text are wrapped automatically.

The **Cash** tab reads `cash_forecast` from the private data payload (box file cash-forecast.json, sanitized by export-data.js). Figures are never stored in this page.
