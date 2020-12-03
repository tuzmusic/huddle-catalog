export type File = {
  name: string;
  url: string;
  rootFolderId: string;
}
export type SerializableFolder = {
  name: string;
  url: string;
  id: string;
  files: File[];
  rootFolderId: string;
}
export type Folder = SerializableFolder & { subfolders: Folder[] }

export type HuddleInstance = {
  rootFolder: Folder;
}