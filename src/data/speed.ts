export const SPEED_SCALE = 2;

/** Scale horizontal travel while retaining altitude bands and timing in ticks. */
export const scaleTravel = (distance: number): number => distance * SPEED_SCALE;
