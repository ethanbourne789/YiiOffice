#!/bin/sh
# deb/rpm post-install: expose the yiioffice command line shipped inside the app.
# Only an absent name, a dead link or a link into our own install dir is taken
# over; anything else at /usr/bin/yiioffice belongs to another program (yiioffice#893).
set -e
launcher="/opt/YiiOffice/resources/cli/yiioffice"
link="/usr/bin/yiioffice"
[ -x "$launcher" ] || exit 0
if [ -L "$link" ]; then
  case "$(readlink "$link")" in
    /opt/YiiOffice/*) ;;
    *) [ -e "$link" ] && { echo "yiioffice: $link is another program, left as is; run: ln -s $launcher $link" >&2; exit 0; } ;;
  esac
elif [ -e "$link" ]; then
  echo "yiioffice: $link is another program, left as is; run: ln -s $launcher $link" >&2
  exit 0
fi
ln -sfn "$launcher" "$link"
exit 0
