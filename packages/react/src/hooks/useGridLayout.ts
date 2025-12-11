import { useMemo, useEffect, RefObject } from 'react';
import { useSize } from './useSize';
import type { GridLayoutInfo } from '../components/layouts/types';

const ASPECT_RATIO = 16 / 9;
const DEFAULT_GAP = 8;

interface GridLayoutOptions {
  gap?: number;
  minTileWidth?: number;
  minTileHeight?: number;
}

export function useGridLayout(
  gridElement: RefObject<HTMLElement | null>,
  tileCount: number,
  options: GridLayoutOptions = {}
): { layout: GridLayoutInfo; containerWidth: number; containerHeight: number } {
  const { gap = DEFAULT_GAP, minTileWidth = 120, minTileHeight = 68 } = options;
  const { width, height } = useSize(gridElement);

  const layout = useMemo(() => {
    if (width <= 0 || height <= 0 || tileCount <= 0) {
      return {
        columns: 1,
        rows: 1,
        maxTiles: 1,
        tileWidth: 0,
        tileHeight: 0,
      };
    }

    let bestLayout = {
      columns: 1,
      rows: 1,
      maxTiles: 1,
      tileWidth: 0,
      tileHeight: 0,
      area: 0,
    };

    for (let cols = 1; cols <= tileCount; cols++) {
      const rows = Math.ceil(tileCount / cols);
      const availableWidth = width - (cols - 1) * gap;
      const availableHeight = height - (rows - 1) * gap;

      let tileWidth = availableWidth / cols;
      let tileHeight = tileWidth / ASPECT_RATIO;

      if (tileHeight * rows > availableHeight) {
        tileHeight = availableHeight / rows;
        tileWidth = tileHeight * ASPECT_RATIO;
      }

      if (tileWidth * cols > availableWidth) {
        tileWidth = availableWidth / cols;
        tileHeight = tileWidth / ASPECT_RATIO;
      }

      if (tileWidth < minTileWidth || tileHeight < minTileHeight) {
        continue;
      }

      const area = tileWidth * tileHeight;

      if (area > bestLayout.area) {
        bestLayout = {
          columns: cols,
          rows,
          maxTiles: cols * rows,
          tileWidth: Math.floor(tileWidth),
          tileHeight: Math.floor(tileHeight),
          area,
        };
      }
    }

    if (bestLayout.tileWidth === 0) {
      const cols = Math.max(1, Math.floor(width / minTileWidth));
      const rows = Math.ceil(tileCount / cols);
      const tileWidth = Math.floor((width - (cols - 1) * gap) / cols);
      const tileHeight = Math.floor(tileWidth / ASPECT_RATIO);

      return {
        columns: cols,
        rows,
        maxTiles: cols * rows,
        tileWidth: Math.max(tileWidth, minTileWidth),
        tileHeight: Math.max(tileHeight, minTileHeight),
      };
    }

    return {
      columns: bestLayout.columns,
      rows: bestLayout.rows,
      maxTiles: bestLayout.maxTiles,
      tileWidth: bestLayout.tileWidth,
      tileHeight: bestLayout.tileHeight,
    };
  }, [width, height, tileCount, gap, minTileWidth, minTileHeight]);

  useEffect(() => {
    if (gridElement.current && layout) {
      gridElement.current.style.setProperty('--ermis-col-count', layout.columns.toString());
      gridElement.current.style.setProperty('--ermis-row-count', layout.rows.toString());
    }
  }, [gridElement, layout]);

  return {
    layout,
    containerWidth: width,
    containerHeight: height,
  };
}

