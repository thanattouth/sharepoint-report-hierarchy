import type {
  ExtractSensitivityLabelsResponse,
  GraphSensitivityLabelAssignment,
} from "./types";

export function sensitivityLabelAssignments(
  response: ExtractSensitivityLabelsResponse,
): GraphSensitivityLabelAssignment[] {
  return response.labels ?? response.value?.labels ?? [];
}
