# Settings, language, theme and integrations

## Opening settings

The account row at the bottom left of Home opens the settings panel (it reads Sign in when you are logged out). It has several sections: Account, General, Integrations and About.

![Settings ▸ General, where language, theme, AutoSave and the usage-statistics switch live](img/settings-general.png)

## Language

- The settings offer **2 UI languages**: English and Simplified Chinese.
- Switching applies immediately and persists; the native menu bar rebuilds with the language.

## Theme

Light / Dark / System. System follows the OS appearance, and the editors re-skin in sync without flashing.

## General

- **Send anonymous usage statistics** — on by default. It uses Google Analytics 4 and sends your public IP address and transport metadata; document contents and file names are never collected, and every event carries only a type like "opened a .docx". Turn it off here at any time.
- **Auto-save all documents** turns AutoSave on by default in every editor; you can still switch it off for one window.
- **Save Location** with a **Change** button, and **Default app for Office documents** to claim .docx / .xlsx / .pptx for YiiOffice.

## About

- **Version**, the project's GitHub link and a **Star on GitHub** button.
- **Update Channel**: Stable or Beta. Changing it takes effect at once and checks for an update; it will not downgrade a Beta install back to Stable.

## Default app bindings

Settings can register YiiOffice as the handler for .docx / .xlsx / .pptx / .pdf and friends (platform-level default-app registration; confirm when prompted).

## Third-party notices and updates

- Help ▸ Third-party notices: the full OSS license inventory shipped with the app.
- Help ▸ Check for updates: triggers a manual check; a newer version prompts to install.

## Account sign-in

- The sign-in entry (settings or the cloud project list) uses a **device-code** flow: YiiOffice shows a code and opens the browser login; it continues automatically once done.
- Sign-in is used only for: the cloud project list and hosted models. Without it, every local feature and custom models keep working.
- Sign out is one click in settings.

## Command-line cheat sheet

| Command            | What it does               |
| ------------------ | -------------------------- |
| `yiioffice <file>` | open a file                |
| `yiioffice --help` | every command and flag     |
