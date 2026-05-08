#!/bin/bash
set -e

# Virtual display — required for Chromium (not truly headless, needs Xvfb)
Xvfb :99 -screen 0 1920x1080x24 &
echo "Xvfb started on :99"

# PulseAudio daemon with infinite idle timeout
pulseaudio --start --exit-idle-time=-1 --log-target=stderr
sleep 1

# Null sink so FFmpeg has a monitor source to read from
pactl load-module module-null-sink \
  sink_name=virtual_sink \
  sink_properties=device.description="MeetingBotSink"

echo "PulseAudio null sink 'virtual_sink' created"

export PULSE_SINK=virtual_sink
export DISPLAY=:99

exec node /app/apps/worker/dist/index.js
