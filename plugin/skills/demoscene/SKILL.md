---
name: demoscene
description: Make a tiny procedural 3D world (a signed-distance-field scene in GLSL, demoscene style) for workshop's Demoscene tile, where the user flies around it. Use when the user asks for a world, a scene, a landscape, a demo, "something to fly around", "make me a canyon / ocean / city / cave…", or wants to change the one that is showing ("more fog", "make it night", "add towers"); and for every "[Demoscene] …" line the tile types into this session. Also to look at what the tile shows, or switch between saved worlds.
---

# Demoscene

The Demoscene tile runs a world from a few lines of GLSL that you write. Its full guide (the
scene's contract, the helpers, how to load it, look at it and fix it, and how to make it good)
comes from the tile itself, so it is always the version the tile runs:

```bash
node "$WORKSHOP_TILE" demoscene guide
```

Read it before you write a world, then follow it.

**Lines the tile types into this session.** The tile has a prompt box. What the user types there
arrives here as one line starting `[Demoscene]`, with their words in quotes and the title of the
world showing. Treat it as the user asking you directly: make the world (or change the one
showing, if that is what they asked), load it, look at a snap, fix what you see, and answer in a
line or two. Keep the reply short: they are watching the tile, not the conversation.

If a call says the tile is off, ask the user to turn the Demoscene tile on in workshop's column.
