# TODOS

## Country picker for the PHONE card field
- **What:** Replace the fixed `features.phoneDialCode` prefix with a dial-code picker: a static
  country/dial-code table and a React Native `Modal` list. No libphonenumber.
- **Why:** A client whose users are in several countries can't use one fixed code. The web widget
  picks the country automatically with an IP lookup on `ip2c.org`, which we skipped for privacy.
- **Pros:** Correct international numbers for multi-country apps.
- **Cons:** About 250 table rows plus a picker UI to maintain.
- **Context:** WEB_PARITY_PLAN.md Step 4 adds `withDialCode` in FormCard (it strips the trunk 0).
  Start there. The web sends vue-tel-input's international format, e.g. `+91 98765 43210`.
- **Depends on:** Step 4.

## Quick reply while a form field is bound
- **What:** When one bot message has both `options.inputs` and `options.buttons`, the web also
  copies the tapped label into `form[inputs[0].name]`. In `onMessageWasSent`, the `form_input`
  branch runs after the `reply_id` branch.
- **Why:** Exact parity for that combination. No real payload sends it today.
- **Pros:** About 2 lines in `client.sendQuickReply`.
- **Cons:** Only worth doing once a bot actually sends inputs and buttons together.
- **Context:** Web module `510c`, `onMessageWasSent`. If inputs[0] is EMAIL, the web also
  validates the label as an email.
- **Depends on:** WEB_PARITY_PLAN.md Steps 1-2.
