/** Tap recognition only: the editor still owns target, modal, drag, and validation guards. */
export const EDITOR_BACKGROUND_SELECTOR = '.fs-editor, .fs-visual-area, .fs-tree, .fs-tree-tail, .fs-tree-item, .fs-panel-heading, .fs-editor-toolbar, .fs-tree-help, .fs-selection-summary';
export const BACKGROUND_TAP_DISTANCE = 8;
export const BACKGROUND_TAP_DURATION = 500;

export interface BackgroundTapPointer {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  button: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
}
interface Candidate {
  pointer: BackgroundTapPointer;
  scrollPositions: number[];
}

function finitePointer(pointer: BackgroundTapPointer) {
  return [pointer.pointerId, pointer.clientX, pointer.clientY, pointer.timeStamp].every(Number.isFinite);
}

/** Recognize a short stationary touch without preventing native scrolling or capturing pointers. */
export class BackgroundTapTracker {
  private candidate: Candidate | null = null;
  private lastPointerType = '';

  start(pointer: BackgroundTapPointer, background: boolean, scrollPositions: readonly number[]) {
    this.lastPointerType = pointer.pointerType;
    this.candidate = background && pointer.pointerType === 'touch' && pointer.isPrimary && pointer.button === 0
      && finitePointer(pointer) && scrollPositions.every(Number.isFinite)
      ? { pointer: { pointerId: pointer.pointerId, pointerType: pointer.pointerType, isPrimary: pointer.isPrimary, button: pointer.button, clientX: pointer.clientX, clientY: pointer.clientY, timeStamp: pointer.timeStamp }, scrollPositions: [...scrollPositions] } : null;
  }

  move(pointer: BackgroundTapPointer) {
    const start = this.candidate?.pointer;
    if (!start || pointer.pointerId !== start.pointerId) return;
    if (!finitePointer(pointer) || pointer.pointerType !== 'touch' || !pointer.isPrimary
      || Math.hypot(pointer.clientX - start.clientX, pointer.clientY - start.clientY) > BACKGROUND_TAP_DISTANCE) this.cancel();
  }

  end(pointer: BackgroundTapPointer, background: boolean, scrollPositions: readonly number[]) {
    const candidate = this.candidate;
    this.candidate = null;
    if (!candidate || !background || !finitePointer(pointer) || pointer.pointerType !== 'touch'
      || !pointer.isPrimary || pointer.button !== 0 || pointer.pointerId !== candidate.pointer.pointerId) return false;
    const elapsed = pointer.timeStamp - candidate.pointer.timeStamp;
    return elapsed >= 0 && elapsed <= BACKGROUND_TAP_DURATION
      && Math.hypot(pointer.clientX - candidate.pointer.clientX, pointer.clientY - candidate.pointer.clientY) <= BACKGROUND_TAP_DISTANCE
      && scrollPositions.length === candidate.scrollPositions.length
      && scrollPositions.every((position, index) => Number.isFinite(position) && position === candidate.scrollPositions[index]);
  }

  cancel() { this.candidate = null; }

  /** Do not let a later touch-generated click retry a handled or canceled background gesture. */
  ignoreCompatibilityClick(click?: { detail: number; pointerType?: string }) {
    if (click?.detail === 0) return false;
    if (click?.pointerType) return click.pointerType === 'touch';
    return this.lastPointerType === 'touch';
  }
}
