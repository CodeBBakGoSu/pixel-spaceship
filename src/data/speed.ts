export const SPEED_SCALE = 2;

/** Scale horizontal travel while retaining altitude bands and timing in ticks. */
export const scaleTravel = (distance: number): number => distance * SPEED_SCALE;

/** Stage C widened the band gaps 1.5x (75/110/145 -> 75/125/180); hostile vertical rates follow so band changes keep their tick timing. */
export const ALTITUDE_SCALE = 1.5;
export const scaleClimb = (rate: number): number => rate * ALTITUDE_SCALE;
