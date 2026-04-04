export { default as capitalize } from "lodash/capitalize";
export { default as debounce } from "lodash/debounce";
export { default as groupBy } from "lodash/groupBy";
export { default as mapValues } from "lodash/mapValues";
export { default as merge } from "lodash/merge";
export { default as omitBy } from "lodash/omitBy";
export { default as pickBy } from "lodash/pickBy";
export { default as random } from "lodash/random";
export { default as sortBy } from "lodash/sortBy";
export { default as transform } from "lodash/transform";
export { default as slugify } from "slugify";

export function splitArray<T>(array: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    result.push(array.slice(i, i + chunkSize));
  }
  return result;
}
