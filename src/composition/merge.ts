import type { StageResponse } from "@chub-ai/stages-ts";

/**
 * Merge a child StageResponse into an accumulator, namespacing per-id state.
 *
 * - stageDirections / systemMessage: concatenated with \n when both non-empty.
 * - modifiedMessage: last non-null wins; warns when overwriting a prior non-null value.
 * - messageState / chatState: namespaced by id key.
 * - error: first non-null wins.
 */
export function mergeComposedResponses(
  acc: Partial<StageResponse<any, any>>,
  id: string,
  childResp: Partial<StageResponse<any, any>>,
): Partial<StageResponse<any, any>> {
  const out: Partial<StageResponse<any, any>> = { ...acc };

  // stageDirections — concatenate
  if (childResp.stageDirections) {
    out.stageDirections = acc.stageDirections
      ? `${acc.stageDirections}\n${childResp.stageDirections}`
      : childResp.stageDirections;
  }

  // systemMessage — concatenate
  if (childResp.systemMessage) {
    out.systemMessage = acc.systemMessage
      ? `${acc.systemMessage}\n${childResp.systemMessage}`
      : childResp.systemMessage;
  }

  // modifiedMessage — last non-null wins
  if (childResp.modifiedMessage != null) {
    if (acc.modifiedMessage != null) {
      console.warn(
        `[composition] modifiedMessage already set by an earlier instance; overwriting with value from "${id}".`,
      );
    }
    out.modifiedMessage = childResp.modifiedMessage;
  }

  // error — first non-null wins
  if (childResp.error != null && acc.error == null) {
    out.error = childResp.error;
  }

  // messageState — namespace by id
  if (childResp.messageState !== undefined) {
    out.messageState = {
      ...((acc.messageState ?? {}) as object),
      [id]: childResp.messageState,
    };
  }

  // chatState — namespace by id
  if (childResp.chatState !== undefined) {
    out.chatState = {
      ...((acc.chatState ?? {}) as object),
      [id]: childResp.chatState,
    };
  }

  return out;
}
