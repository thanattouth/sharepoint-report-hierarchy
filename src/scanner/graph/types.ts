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

export type ExtractSensitivityLabelsResponse = {
  value?: {
    labels?: Array<{
      sensitivityLabelId?: string;
      assignmentMethod?: string;
      tenantId?: string;
    }>;
  };
};
