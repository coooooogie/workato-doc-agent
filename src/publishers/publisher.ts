export interface Documentation {
  recipeId?: number;
  projectId?: number;
  managedUserId: string;
  contentMd: string;
  contentHtml: string;
  qualityScore?: number;
}

export interface PublishMetadata {
  recipeName?: string;
  projectName?: string;
  projectSlug?: string;
  isProjectDoc?: boolean;
}

export interface Publisher {
  publish(doc: Documentation, metadata: PublishMetadata): Promise<void>;
}
