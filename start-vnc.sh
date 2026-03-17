#!/bin/bash
# Start x11vnc on Xvfb :0 display
X11VNC=/nix/store/4rxi8q5x6yb39ykygl5ddvmlx6v26gjy-x11vnc-0.9.17/bin/x11vnc
NOVNC=/nix/store/0a18wyirbc3ls9yvlw33lrmql94n2hmc-novnc-1.5.0/bin/novnc

# Kill existing
pkill -f x11vnc 2>/dev/null || true
pkill -f "novnc\|websockify" 2>/dev/null || true
sleep 1

# Start x11vnc in background (no password, view-only: allow full control)
$X11VNC -display :0 -forever -nopw -shared -bg -q -rfbport 5900 -noipv6 2>/dev/null

sleep 1

# Start noVNC websocket proxy on port 6080
exec $NOVNC --listen 0.0.0.0:6080 --vnc localhost:5900 --web /nix/store/0a18wyirbc3ls9yvlw33lrmql94n2hmc-novnc-1.5.0/share/webapps/novnc
