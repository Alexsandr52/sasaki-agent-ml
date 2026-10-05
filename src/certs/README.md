# Career source TLS certificate

`russian-trusted-root.pem` is the public Russian Trusted Root CA, retrieved on 2026-10-04 over validated HTTPS from https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt (Gosuslugi CDN).

Official bank guidance: https://developer.tbank.ru/docs/tls-settings and https://developers.sber.ru/docs/ru/salutespeech/quick-start/certificates.

`src/lib/source-fetch.mjs` uses this root only for its explicit bank career hostname allowlist. It retains hostname, expiry and chain validation. It never changes OS trust or disables TLS validation. Other hosts use Node's usual trust roots. Review certificate changes and its SHA-256 fingerprint before replacing this file.
