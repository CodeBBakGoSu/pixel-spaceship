import { WORLD_SITES } from './world.ts';
import { scaleTravel } from './speed.ts';

export const RADAR_RANGE = scaleTravel(210);
export const NAV_MAP_RANGE = WORLD_SITES.spacing;
export const TAIL_TRACK_RANGE = scaleTravel(140);
export const TAIL_MIN_CLOSING_SPEED = scaleTravel(5);
