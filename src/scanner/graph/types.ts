export type GraphCollection<T> = {
  value: T[];
  "@odata.nextLink"?: string;
};

export type GraphDrive = {
  id: string;
  name: string;
  webUrl?: string;
  driveType?: string;
};

export type GraphDriveItem = {
  id: string;
  name?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  deleted?: Record<string, never>;
  parentReference?: {
    path?: string;
  };
};

export type GraphDeltaResponse = GraphCollection<GraphDriveItem> & {
  "@odata.deltaLink"?: string;
};

export type GraphSensitivityLabelAssignment = {
  sensitivityLabelId?: string;
  assignmentMethod?: string;
  tenantId?: string;
};

export type ExtractSensitivityLabelsResponse = {
  // Microsoft Graph currently returns labels at the top level. Keep the nested
  // shape for compatibility with earlier responses and recorded test fixtures.
  labels?: GraphSensitivityLabelAssignment[];
  value?: {
    labels?: GraphSensitivityLabelAssignment[];
  };
};
