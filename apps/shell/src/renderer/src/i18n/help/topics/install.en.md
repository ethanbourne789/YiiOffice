# Installing YiiOffice

Every build is published on the [Releases page](https://gitee.com/ethanbourne789/yiioffice/releases/latest). All of them come from `main`; the macOS and Windows installers are signed.

## Pick the file for your machine

| Platform                             | Requirements                                          | File                   |
| ------------------------------------ | ----------------------------------------------------- | ---------------------- |
| **macOS** — Apple Silicon            | macOS 11+                                             | `.dmg` (arm64)         |
| **macOS** — Intel                    | macOS 11+                                             | `.dmg` (x64)           |
| **Windows** — most PCs               | Windows 10+, Intel/AMD                                | `-x64.exe` installer   |
| **Linux** — Debian / Ubuntu          | x86_64, glibc 2.34+ (Ubuntu 22.04 or newer)           | `.deb`                 |
| **Linux** — Fedora / RHEL / openSUSE | x86_64, glibc 2.34+ (Fedora 35+, RHEL 9+, Leap 15.6+) | `.rpm`                 |
| **Linux** — anything else            | x86_64, glibc 2.34+, FUSE 2                           | `.AppImage`            |

Older versions stay on the Releases page.

## On macOS

Open the `.dmg` and drag **YiiOffice** into Applications. On an Intel build the first launch asks you to confirm opening it: right-click the app in Applications ▸ Open. That is Gatekeeper meeting an unsigned-seeming disk image, not a damaged download.

## On Windows

Run the `.exe` installer. It puts YiiOffice in the Start menu and registers `.docx`, `.xlsx`, `.pptx`, `.pdf` and friends so double-clicking a file opens it.

## On Linux

**Debian / Ubuntu**

```sh
sudo apt install ./yiioffice_<version>_amd64.deb
```

**Fedora / RHEL / openSUSE**

```sh
sudo dnf install ./yiioffice-<version>.x86_64.rpm     # Fedora / RHEL family
sudo zypper install ./yiioffice-<version>.x86_64.rpm  # openSUSE
```

**AppImage** — runs where it is, with no install step:

```sh
chmod +x YiiOffice-<version>.AppImage
./YiiOffice-<version>.AppImage
```

It needs the FUSE 2 runtime. If you would rather not install it, run it with `--appimage-extract-and-run` and the sandbox works from the extracted directory.

## The build you are running

**Settings ▸ About** shows the installed version and project information.

![Settings ▸ About, showing the installed version, the update channel the app follows, and the project's GitHub link](img/install.png)

## The command line comes with it

Every install ships a `yiioffice` command that talks to the same engines the window does, so the two never disagree about a file. On macOS and Windows it is inside the app bundle; `yiioffice install-cli` puts it on your `PATH`. See **Command line and agents** for what it can do.
