# Sound library

Sounds in here are shared by every campaign. Sounds that only belong to one campaign can go in that campaign's own `audio` folder instead, using the same layout. Both show up together in the sound panel.

```
library\
  audio\
    ambient\   loops that play under a scene (rain, tavern crowd, dungeon drips)
    music\     one folder per playlist
      Combat\
      Exploration\
      Tavern\
    sfx\       short one-shots (door creak, thunder, roar)
```

The folders are created the first time Table Rig starts. Click **Refresh** after adding files. Sound files aren't uploaded to git.

## Where to get free sounds

All of these are fine for a home game. Rules on sharing or reusing them elsewhere vary, so check each site's terms if you ever stream or record.

**Tabletop Audio** (tabletopaudio.com). The best single source for this. Hundreds of 10 minute ambiences made for RPGs (taverns, caves, storms, battles), plus a soundboard section. Free for noncommercial use. Put the ambiences in `ambient`. Some are more musical and work better in a `music` playlist.

**Freesound** (freesound.org). A huge library of individual sound effects. Needs a free account to download. Each sound has its own license. Searching with the CC0 filter on gets you ones with no strings attached. Best for `sfx`: search "door creak", "sword unsheathe", "dragon roar", "thunder".

**Kenney** (kenney.nl, "RPG Audio" and "Impact Sounds" packs). Public domain (CC0) game sound effects. Short and punchy: footsteps, metal hits, coins, doors. Unzip into `sfx`.

**Kevin MacLeod / Incompetech** (incompetech.com). A large royalty-free music catalog, free with credit (Creative Commons Attribution). Search the genre filter for "Fantasy" or "Horror" and make playlists from the results.

## Tips

- MP3 and OGG both work. OGG loops more seamlessly for ambience.
- Keep effects short (under a few seconds) so they fire instantly.
- Name files the way you'd search for them at the table: "Door creak", not "SFX_0412".
- Effects get assigned to the number keys 1 through 0 in the sound panel ("Change keys").
