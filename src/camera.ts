export type Segment = 'overhead' | 'chase' | 'cockpit';
export type CameraState = {
  mode: Segment; x: number; z: number; yaw: number; altitude: number;
  pitch: number; camOffset: number; camHeightOffset: number; crossFade: number;
};
