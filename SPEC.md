# Table Rig: Spec

A local app for running in-person Pathfinder 1e homebrew games. It handles atmosphere and presentation only: maps, fog of war, sound, and a mood slideshow. Rules, notes, and prep stay on paper.

Status: agreed spec, nothing built yet.

## The setup

Three screens, one GM.

| Screen | Hardware | Shows |
| --- | --- | --- |
| Control panel | GM's Windows laptop | Everything, including fog as a translucent overlay |
| Map screen | 24-27" monitor laid flat on the table, or a projector for big fights | The battle map under fog, at 1 square = 1 inch so minis fit |
| Mood screen | Upright monitor facing the group | Slow crossfading slideshow |

Audio plays through a wired speaker connected to the laptop. Internet is available but the app should not need it at the table.

Input is keyboard hotkeys and mouse on the laptop. No phone remote (cut on purpose to keep this simple).

## How it runs

A small local server on the laptop (Node.js) serves the app and the asset folders. The GM starts it by double-clicking `start.bat`, which opens the control panel in the browser (Edge or Chrome). Each player screen is another browser window opened from the control panel, dragged to its monitor, and put into fullscreen. All windows stay in sync through the local server.

Saved state (calibrations, fog, scenes) lives in plain JSON files next to the assets, so a campaign folder can be backed up or copied as one thing.

## Asset folders

One folder per campaign:

```
campaigns/
  my-campaign/
    maps/      battle map images (jpg, png, webp)
    audio/
      ambient/ loops
      music/   playlist tracks
      sfx/     one-shots
    images/    mood slideshow pictures
    data/      saved state, managed by the app
```

Prep is "drop files in the folder, build a scene." No importing step.

## Features

### 1. Maps and fog (week 1)

This is the core feature and it is useful on its own.

**Display calibration.** Measure each display once (drag a box until it matches a ruler or a credit card on the screen). Saved per display so switching between the monitor and the projector is one click.

**Map calibration.** Downloaded maps use different pixels per square (70, 100, 140, 200 are all common). For each map, click the corners of one grid square once. Saved per map file.

**Panning.** At 1 inch squares a 27" monitor fits about 23 x 13 squares, so panning will be frequent.
- Free pan and zoom on the control panel while no minis are on the map.
- "Minis down" mode locks panning to whole-square jumps. The map screen shows a large arrow and count (for example "← 8 squares") so players can move their minis the same amount.
- Zoom on the map screen stays at true scale while in minis-down mode.

**Fog of war.** Paint to reveal with a brush and a rectangle tool on the control panel. No pre-drawn rooms. Includes:
- Undo (Ctrl+Z) for reveals.
- A re-fog brush to cover things back up.
- Fog is saved per map and persists between sessions.

**GM view.** The control panel shows the whole map with fog drawn as a translucent overlay, plus an outline of exactly what the map screen is showing right now.

**Stage, then push.** Choosing a new map loads it on the control panel only. Players see nothing until the GM hits Show. On by default for maps and images, off for audio.

**Blackout.** One hotkey instantly blanks both player screens. Press again to restore.

### 2. Audio (week 2)

- **Ambient layers.** Several loops playing at once, each with its own volume slider (rain + fire + crowd).
- **Music playlists.** Named playlists (combat, exploration, tavern) with crossfade between tracks and between playlists.
- **SFX soundboard.** One-shot buttons, each bound to a hotkey.
- Master volume and a mute-all hotkey.

Audio source: the GM doesn't have a library yet. Part of this phase is putting together a free starter pack (Creative Commons or royalty free, for example Tabletop Audio and Freesound) and recording the license for each file in a credits file.

### 3. Scenes and mood screen (week 3)

**Mood screen.** A slow slideshow that crossfades through a set of images. Speed is adjustable. No collages, text, or handouts for now.

**Scenes.** A scene bundles a map, ambient layers and their volumes, a playlist, and a set of slideshow images. Built during prep, loaded with one click or hotkey at the table. After loading, everything can still be adjusted live. Loading a scene respects stage-then-push for the map.

On a new session, fog is restored but audio and the scene start fresh.

If time runs short before game night, the slideshow is the first thing to cut.

### 4. Generated maps (after game night)

Mainly for live use at the table: the players go somewhere unplanned, the GM types a short description, and a usable battle map is ready in about 15 seconds.

**How it works.** The GM types a description ("forest road, overturned wagon, ravine on the north side"). Claude turns it into a structured layout: walls, rooms, doors, stairs, trees, rocks, water, furniture, and so on, each placed on grid squares. The app then draws that layout itself as clean black-and-white line art. No AI image generation, because image models don't keep walls and features lined up with the grid, and that would break calibration and fog.

**Map types:**
- Dungeons, caves, and interiors.
- Buildings such as taverns, temples, manors, and shops, with simple furniture.
- Outdoor encounters such as clearings, roads, camps, and rivers, with trees, rocks, and water drawn as simple symbols.

Town and region overview maps are out of scope.

**Fixing a result:**
- **Regenerate:** same description, new attempt.
- **Tweak by text:** type a change ("add a door on the north wall", "make the river wider") and the current map is revised rather than started over.

No hand editing of walls or features.

**Fitting the table.** By default, generated maps are sized to fit the current map screen at true scale (about 23 x 13 squares on the 27" monitor), so there's no panning mid-fight. A larger size can be picked when the projector is in use.

**At the table.** Generated maps go through stage-then-push like any other map, so the GM checks it before the players see it. Each one is saved into the campaign's `maps/` folder with its layout data, so fog, calibration, and scenes treat it like a normal map, and it can be reused later.

**Needs:** internet and a Claude API key. The key goes in a local settings file that is never committed to git. The cost is a few cents per map at most.

## Hotkeys (draft)

| Key | Action |
| --- | --- |
| B | Blackout on/off |
| Enter | Show staged map or image |
| Ctrl+Z | Undo fog |
| Arrow keys | Grid-pan in minis-down mode |
| 1-9, 0 | SFX slots |
| F1-F12 | Load scene |
| M | Mute all audio |
| G | Open the map generator |

Final bindings will be configurable.

## Out of scope

- Rules, character sheets, initiative tracking, campaign notes.
- Digital tokens (physical minis only).
- Dynamic lighting and line of sight.
- Online or remote play.
- Phone or tablet remote control.
- Collage mood boards, handouts, text cards.
- AI-painted map images, hand editing of generated maps, and town or region maps.

## Timeline

Next game is 2-4 weeks out. Week 1 maps and fog, week 2 audio, week 3 scenes and slideshow, leaving some slack for a dry run on the real hardware before game night. Generated maps come after that, so they can't put the first session at risk.
