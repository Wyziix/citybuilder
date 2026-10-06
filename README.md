# CityBuilder

An isometric city builder in the style of TheoTown / SimCity, running in the browser. No install, no build step, no internet needed.

## How to run

1. Download or clone this repo.
2. Double-click `index.html`. It opens in your browser and you can play right away.

Works in Chrome, Edge, Firefox and Safari. If your browser blocks local files for some reason, run a tiny local server from the folder instead:

```
python3 -m http.server 8000
```

then open http://localhost:8000.

## How to play

1. Build a **road** off the map center.
2. Drag **zones** next to the road: green = homes, blue = shops/offices, yellow = industry. Zones grow up to 3 tiles from a road.
3. Build a **power plant** and connect it. Roads, zones, buildings and power lines all carry power.
4. Add a **water pump** (next to water) or **water tower**. Without water, buildings stay small.
5. Add police, fire, healthcare, schools and parks. Higher land value + water = apartment blocks and skyscrapers.
6. Watch the **R C I** bars in the top bar. They show what people want more of.

New buildings unlock as the population grows (solar, hospital, university, stadium, nuclear, airport, Sky Tower...).

## Controls

| Input | Action |
| --- | --- |
| Right-drag / middle-drag / WASD / arrows | Move camera |
| Mouse wheel / `+` `-` | Zoom |
| Space | Pause / resume |
| Esc | Inspect tool, close panels |
| `R` `P` `B` `T` | Road, power line, bulldoze, trees |
| `1` `2` `3` | Residential, commercial, industrial zone |
| Ctrl+S | Quick save |
| Touch | One finger builds, two fingers pan and zoom |

## Features

- Procedural maps: river valley, coastline, lakes, island. Three map sizes, optional seed.
- Zoning with 3 growth levels per zone type, abandonment, construction phases.
- Power and water networks with capacity, shortages and blinking warning icons.
- Services with coverage radius: police, fire, clinic, hospital, school, university, landfill, incinerator.
- Simulated land value, pollution, crime, traffic and happiness, each with its own map overlay.
- Budget with per-zone tax rates, monthly report and loans.
- Cars driving on the roads, smoke from chimneys, day/night cycle with lit windows and street lights.
- Fires that spread, plus disasters you can trigger: fire, meteor, tornado, earthquake.
- Advisor messages, city ranks (Hamlet up to Megalopolis), building unlocks.
- Statistics with population and money graphs.
- Save slots, autosave every 2 minutes, export/import to a file.
- Sandbox mode with unlimited money and everything unlocked.

## Code layout

Plain JavaScript, no dependencies. All graphics are drawn in code at runtime.

| File | What it does |
| --- | --- |
| `js/util.js` | Math, random numbers, noise, colors |
| `js/defs.js` | Buildings, tools, zones, unlocks |
| `js/sprites.js` | Procedural sprites for terrain, roads, trees, buildings |
| `js/world.js` | Map data and terrain generation |
| `js/game.js` | Simulation, economy, growth, disasters, tools |
| `js/agents.js` | Cars, particles, meteors, tornadoes |
| `js/render.js` | Isometric renderer, overlays, night lighting |
| `js/ui.js` | Top bar, menus, panels, saves, minimap |
| `js/input.js` | Mouse, touch, keyboard |
| `js/main.js` | Startup and main loop |
