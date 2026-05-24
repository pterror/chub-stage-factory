/**
 * Ambient module declaration for d3-weighted-voronoi v1.1.x.
 * No @types package exists; types are hand-written from source inspection.
 *
 * The library computes a power diagram (weighted Voronoi) from a set of sites.
 * Each site must have x, y, and weight accessors. The return value is an array
 * of polygon arrays (each is [number, number][]) with a `.site` property
 * pointing back to the internal Vertex object whose `.originalObject` field
 * holds the original input datum.
 */
declare module "d3-weighted-voronoi" {
  type Point2D = [number, number];

  /** Internal vertex object attached to each output polygon. */
  interface WVVertex<D> {
    x: number;
    y: number;
    weight: number;
    isDummy: boolean;
    /** The original input datum passed to the x/y/weight accessors. */
    originalObject: D;
  }

  /** Output polygon: an array of [x, y] vertices plus a `.site` back-reference. */
  interface WVPolygon<D> extends Array<Point2D> {
    site: WVVertex<D>;
  }

  interface WeightedVoronoi<D> {
    (data: D[]): WVPolygon<D>[];
    x(accessor: (d: D) => number): WeightedVoronoi<D>;
    y(accessor: (d: D) => number): WeightedVoronoi<D>;
    weight(accessor: (d: D) => number): WeightedVoronoi<D>;
    /** Convex clipping polygon as array of [x, y] vertices. */
    clip(polygon: Point2D[]): WeightedVoronoi<D>;
    extent(extent: [Point2D, Point2D]): WeightedVoronoi<D>;
    size(size: [number, number]): WeightedVoronoi<D>;
  }

  export function weightedVoronoi<D = Record<string, unknown>>(): WeightedVoronoi<D>;
}
