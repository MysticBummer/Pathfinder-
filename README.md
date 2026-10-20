# Table Rig

Puts your battle maps on the table screen with fog of war, at true scale for minis, all driven from your laptop. See [SPEC.md](SPEC.md) for the full plan.

Built so far: maps, fog of war, grid and screen calibration, minis-down panning, blackout, and sound (ambient layers, music playlists, and an effects soundboard). Coming next: scenes, mood slideshow, and initiative.

## One-time setup (Windows)

1. Install Node.js, the **LTS** version, from https://nodejs.org. Click through the installer with the defaults.
2. Download this repo (green **Code** button on GitHub, then **Download ZIP**) and unzip it somewhere you'll remember, like `Documents\Table Rig`.
3. Double-click `start.bat`. A black window opens (leave it open while you play) and the control panel opens in your browser.

## Your maps

Each campaign is a folder inside `campaigns`. Make one for your game and drop map images into its `maps` folder:

```
campaigns\
  my-campaign\
    maps\
      Goblin Warrens.jpg
      Ruined Chapel.png
```

Subfolders inside `maps` are fine. Click **Refresh** in the control panel after adding files. Your campaign folders stay on your laptop and are never uploaded to git. Fog and calibration are saved in each campaign's `data` folder, so back up the whole campaign folder.

## Your sounds

Shared sounds go in `library\audio`, and sounds for one campaign go in that campaign's `audio` folder. See [library/README.md](library/README.md) for the layout and where to get free sounds.

The sound panel on the right of the control panel has:

- **Ambience**: click sounds to layer them, each with its own volume. Click again or × to fade one out.
- **Music**: each folder in `music` is a playlist. Click one to start it. Tracks crossfade into each other and the playlist loops.
- **Effects**: number keys 1 through 0 fire the effects assigned to them. "Change keys" to reassign. Click any effect in the list to play it.

The sound comes out of the laptop, so plug your speaker into the laptop.

## First time with a new screen

1. In the control panel click **Open table screen**. Drag that window onto the table monitor and click it to go fullscreen.
2. Under **Table screen size**, tick **Show ruler on table**. Use the **+ / −** buttons until the ruler on the table matches a real ruler (or a bank card fits the box). Untick it when done.
3. Using a projector too? Click **New display**, name it, and calibrate it the same way. Switch between them with the dropdown.

## First time with a new map

1. Click the map in the list. It's **staged**: only you can see it.
2. Click **Set grid**, then click one corner of a grid square, then the opposite corner. For better accuracy, set "Squares between clicks" to something like 10 and click corners 10 squares apart. Tick **Show grid overlay** to check it lines up, and nudge with the **+ / −** buttons if not.

You only do this once per map.

## At the table

| Key | What it does |
| --- | --- |
| Enter | Put the staged map on the table |
| B | Blackout on and off |
| Left drag | Reveal fog (or re-fog, press X to switch) |
| Q / W | Brush / box tool |
| [ and ] | Brush smaller / bigger |
| Ctrl+Z | Undo the last fog change |
| V | Drag the yellow box to move what the table shows |
| F | Toggle the table between true scale and the whole map |
| D | Minis down: lock the map so it only moves in whole squares |
| Arrow keys | Move the table view one square (Shift + arrow for five) |
| Space | Apply the move (minis-down mode). The table tells players which way to slide their minis |
| Esc | Cancel a pending move |
| Right drag, wheel | Look around your own view without touching the table |
| 1 to 0 | Play the effect on that key |
| M | Mute and unmute all sound |
| − and + | Master volume down and up |

Your view shows the whole map with fog as a dark tint. The yellow box is exactly what the players see.

## Troubleshooting

- **"Port 3210 is already in use"**: Table Rig is already running. Just open http://localhost:3210 in your browser.
- **The table screen is black**: check you've pressed Enter to show a map, that blackout is off, and that you've revealed some fog.
- **No sound**: click anywhere in the control panel once. Browsers block sound until you've clicked or pressed a key.
- **Squares are the wrong size on the table**: recheck the screen ruler first, then the map's grid.
