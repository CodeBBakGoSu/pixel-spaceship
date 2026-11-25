export function shouldShowSwarmNotice(runMode: boolean, kind: string | undefined): boolean {
  return kind !== undefined && (!runMode || kind !== 'recovery');
}
