const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());

export const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.orientation !== undefined;

export const PARTICLE_INIT = params.particle_init || "circle";
export const PARTICLE_CNT = ~~params.particle_count || (IS_MOBILE ? 10000 : 20000);
export const RESISTANCE = Math.max(0.1e-3, Math.min(1, Number.parseFloat(params.resistance) || 1));
export const G = Number.parseFloat(params.g) || 1;
export const PARTICLE_G = G / PARTICLE_CNT * 10;

export const MOUSE_POINT_RADIUS = 3;
export const ENABLE_MOUSE = params.mouse ? Number.parseInt(params.mouse) : false;
export const FPS = ~~params.fps || 60;

export const SEGMENT_DIVIDER = Math.max(2, ~~params.segment_divider || 2);
export const SEGMENT_MAX_COUNT = Math.max(2, ~~params.segment_max_count || 32);

export const DEBUG = params.debug ? Number.parseInt(params.debug) : false;
export const STATS = params.stats ? Number.parseInt(params.stats) : true;

export const FILTER_ENABLE = params.filter ? Number.parseInt(params.filter) : false;

const minDistance = params.min_distance ? ~~params.min_distance : 20;
export const MIN_DISTANCE_SQ = Math.pow(minDistance, 2);