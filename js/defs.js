'use strict';
// Game data: zones, buildings, tools, milestones.

const Z_NONE = 0, Z_R = 1, Z_C = 2, Z_I = 3;
const ZONE_COLORS = ['', '#3fbf55', '#3d8bff', '#f2b730'];
const ZONE_NAMES = ['', 'Residential', 'Commercial', 'Industrial'];
const ZONE_KEYS = ['', 'R', 'C', 'I'];

// Zoned building numbers per level (index = level)
const ZONE_CAP = {
  R: [0, 6, 42, 160],   // residents
  C: [0, 6, 30, 120],   // jobs
  I: [0, 12, 40, 95],   // jobs
};
const ZONE_POWER = { R: [0, 1, 4, 12], C: [0, 2, 6, 16], I: [0, 4, 10, 20] };
const ZONE_WATER = { R: [0, 1, 4, 11], C: [0, 1, 4, 10], I: [0, 2, 6, 14] };

// Special (player placed) buildings.
// power/water: output. service: coverage type. park: land value boost.
const BUILDINGS = {
  wind:     { name: 'Wind Turbine', w: 1, h: 1, cost: 600, upkeep: 8, power: 30, unlock: 0, desc: 'Clean, cheap, weak. 30 MW.' },
  coal:     { name: 'Coal Power Plant', w: 2, h: 2, cost: 5000, upkeep: 140, power: 500, pollution: 75, pollR: 9, unlock: 0, desc: 'Lots of power, lots of smog. 500 MW.' },
  solar:    { name: 'Solar Farm', w: 2, h: 2, cost: 4500, upkeep: 40, power: 170, unlock: 800, desc: 'Clean energy. 170 MW.' },
  nuclear:  { name: 'Nuclear Plant', w: 3, h: 3, cost: 32000, upkeep: 450, power: 2600, unlock: 9000, desc: 'Huge clean output. 2600 MW.' },

  pump:     { name: 'Water Pump', w: 1, h: 1, cost: 900, upkeep: 20, water: 600, nearWater: true, powerUse: 3, unlock: 0, desc: 'Must touch water. 600 units.' },
  tower:    { name: 'Water Tower', w: 1, h: 1, cost: 500, upkeep: 10, water: 180, powerUse: 1, unlock: 0, desc: 'Works anywhere. 180 units.' },

  police:   { name: 'Police Station', w: 2, h: 2, cost: 1800, upkeep: 90, service: 'police', radius: 14, powerUse: 5, waterUse: 2, unlock: 0, desc: 'Reduces crime nearby.' },
  fire:     { name: 'Fire Station', w: 2, h: 2, cost: 1800, upkeep: 90, service: 'fire', radius: 14, powerUse: 5, waterUse: 4, unlock: 0, desc: 'Prevents and fights fires.' },
  clinic:   { name: 'Clinic', w: 2, h: 2, cost: 2200, upkeep: 100, service: 'health', radius: 11, powerUse: 5, waterUse: 3, unlock: 0, desc: 'Basic healthcare.' },
  hospital: { name: 'Hospital', w: 3, h: 3, cost: 9000, upkeep: 260, service: 'health', radius: 24, powerUse: 15, waterUse: 8, unlock: 2500, desc: 'Big healthcare coverage.' },
  school:   { name: 'School', w: 2, h: 2, cost: 2500, upkeep: 110, service: 'edu', radius: 13, powerUse: 5, waterUse: 3, unlock: 0, desc: 'Education raises land value.' },
  university:{ name: 'University', w: 3, h: 3, cost: 15000, upkeep: 320, service: 'edu', radius: 30, powerUse: 15, waterUse: 8, unlock: 4000, desc: 'Wide education coverage.' },
  landfill: { name: 'Landfill', w: 3, h: 3, cost: 2000, upkeep: 50, service: 'garbage', radius: 26, pollution: 25, pollR: 5, powerUse: 2, unlock: 0, desc: 'Garbage pickup. A bit smelly.' },
  incinerator:{ name: 'Incinerator', w: 2, h: 2, cost: 7000, upkeep: 140, service: 'garbage', radius: 38, pollution: 35, pollR: 6, powerUse: 8, unlock: 6000, desc: 'Burns garbage, bigger range.' },

  park:     { name: 'Small Park', w: 1, h: 1, cost: 150, upkeep: 2, park: 0.12, parkR: 4, unlock: 0, desc: 'Raises land value nearby.' },
  plaza:    { name: 'Plaza', w: 1, h: 1, cost: 400, upkeep: 4, park: 0.16, parkR: 5, unlock: 600, desc: 'Fountain square.' },
  bigpark:  { name: 'Big Park', w: 2, h: 2, cost: 900, upkeep: 10, park: 0.22, parkR: 7, unlock: 0, desc: 'Pond, trees and paths.' },

  cityhall: { name: 'City Hall', w: 2, h: 2, cost: 6000, upkeep: 100, park: 0.2, parkR: 12, happy: 4, unique: true, powerUse: 5, waterUse: 2, unlock: 1500, desc: 'Citizens feel represented. +4 happiness.' },
  stadium:  { name: 'Stadium', w: 3, h: 3, cost: 22000, upkeep: 240, park: 0.22, parkR: 14, happy: 7, unique: true, powerUse: 20, waterUse: 6, unlock: 6000, desc: 'Big games, big crowds. +7 happiness.' },
  airport:  { name: 'Airport', w: 4, h: 4, cost: 45000, upkeep: 500, pollution: 30, pollR: 8, cBoost: 300, iBoost: 200, unique: true, powerUse: 30, waterUse: 10, unlock: 15000, desc: 'Boosts commercial & industrial demand.' },
  monument: { name: 'Sky Tower', w: 2, h: 2, cost: 60000, upkeep: 120, park: 0.35, parkR: 22, happy: 10, unique: true, powerUse: 20, unlock: 30000, desc: 'The pride of the city. +10 happiness.' },

  rubble:   { name: 'Rubble', w: 1, h: 1, cost: 0, upkeep: 0, internal: true, desc: 'Clears by itself after a while.' },
};

// Tools
const TOOLS = {
  inspect:  { name: 'Inspect', kind: 'inspect', drag: 'single', icon: '🔍', key: 'Esc' },
  bulldoze: { name: 'Bulldoze', kind: 'bulldoze', drag: 'rect', icon: '🚜', key: 'B' },
  road:     { name: 'Road', kind: 'road', drag: 'line', cost: 10, icon: '🛣️', key: 'R', desc: '$10 per tile, bridges $50.' },
  pline:    { name: 'Power Line', kind: 'pline', drag: 'line', cost: 5, icon: '🔌', key: 'P', desc: '$5 per tile. Roads and buildings carry power too.' },
  zoneR:    { name: 'Residential', kind: 'zone', zone: Z_R, drag: 'rect', cost: 5, icon: '🏠', key: '1', desc: '$5 per tile. Homes.' },
  zoneC:    { name: 'Commercial', kind: 'zone', zone: Z_C, drag: 'rect', cost: 5, icon: '🏬', key: '2', desc: '$5 per tile. Shops and offices.' },
  zoneI:    { name: 'Industrial', kind: 'zone', zone: Z_I, drag: 'rect', cost: 5, icon: '🏭', key: '3', desc: '$5 per tile. Factories (pollute).' },
  dezone:   { name: 'De-zone', kind: 'dezone', drag: 'rect', cost: 0, icon: '❌', desc: 'Remove zoning.' },
  tree:     { name: 'Plant Trees', kind: 'tree', drag: 'rect', cost: 5, icon: '🌲', key: 'T', desc: '$5 per tile. Trees absorb pollution.' },
  dFire:    { name: 'Start Fire', kind: 'disaster', disaster: 'fire', drag: 'single', icon: '🔥', desc: 'Set a building on fire.' },
  dMeteor:  { name: 'Meteor', kind: 'disaster', disaster: 'meteor', drag: 'single', icon: '☄️', desc: 'Call down a meteor.' },
  dTornado: { name: 'Tornado', kind: 'disaster', disaster: 'tornado', drag: 'single', icon: '🌪️', desc: 'Spawn a tornado.' },
  dQuake:   { name: 'Earthquake', kind: 'disaster', disaster: 'quake', drag: 'single', icon: '🌋', desc: 'Shake the whole city.' },
};
for (const k in BUILDINGS) {
  if (BUILDINGS[k].internal) continue;
  TOOLS[k] = { name: BUILDINGS[k].name, kind: 'building', building: k, drag: (BUILDINGS[k].w === 1 ? 'paint' : 'single'), cost: BUILDINGS[k].cost, desc: BUILDINGS[k].desc };
}

const CATEGORIES = [
  { id: 'inspect', icon: '🔍', name: 'Inspect (Esc)', tool: 'inspect' },
  { id: 'bulldoze', icon: '🚜', name: 'Bulldoze (B)', tool: 'bulldoze' },
  { id: 'roads', icon: '🛣️', name: 'Roads & Power Lines', items: ['road', 'pline'] },
  { id: 'zones', icon: '🏘️', name: 'Zones', items: ['zoneR', 'zoneC', 'zoneI', 'dezone'] },
  { id: 'power', icon: '⚡', name: 'Power', items: ['wind', 'coal', 'solar', 'nuclear'] },
  { id: 'water', icon: '💧', name: 'Water', items: ['pump', 'tower'] },
  { id: 'services', icon: '🚓', name: 'Services', items: ['police', 'fire', 'clinic', 'hospital', 'school', 'university', 'landfill', 'incinerator'] },
  { id: 'parks', icon: '🌳', name: 'Parks & Nature', items: ['tree', 'park', 'plaza', 'bigpark'] },
  { id: 'special', icon: '🏛️', name: 'Landmarks', items: ['cityhall', 'stadium', 'airport', 'monument'] },
  { id: 'disasters', icon: '☄️', name: 'Disasters', items: ['dFire', 'dMeteor', 'dTornado', 'dQuake'] },
];

const CITY_RANKS = [
  { pop: 0, title: 'Hamlet' },
  { pop: 300, title: 'Village' },
  { pop: 1000, title: 'Town' },
  { pop: 4000, title: 'City' },
  { pop: 15000, title: 'Large City' },
  { pop: 40000, title: 'Metropolis' },
  { pop: 100000, title: 'Megalopolis' },
];

const OVERLAYS = [
  { id: 'none', name: 'None', icon: '🗺️' },
  { id: 'power', name: 'Power', icon: '⚡' },
  { id: 'water', name: 'Water', icon: '💧' },
  { id: 'landValue', name: 'Land Value', icon: '💎' },
  { id: 'pollution', name: 'Pollution', icon: '☁️' },
  { id: 'crime', name: 'Crime', icon: '🦹' },
  { id: 'traffic', name: 'Traffic', icon: '🚗' },
  { id: 'police', name: 'Police', icon: '🚓' },
  { id: 'fire', name: 'Fire', icon: '🚒' },
  { id: 'health', name: 'Health', icon: '🏥' },
  { id: 'edu', name: 'Education', icon: '🎓' },
  { id: 'garbage', name: 'Garbage', icon: '🗑️' },
];

const SERVICE_TYPES = ['police', 'fire', 'health', 'edu', 'garbage'];
