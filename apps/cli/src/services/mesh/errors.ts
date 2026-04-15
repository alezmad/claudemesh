export class MeshNotFoundError extends Error {
  constructor(slug: string) {
    super(`Mesh "${slug}" not found`);
    this.name = "MeshNotFoundError";
  }
}
