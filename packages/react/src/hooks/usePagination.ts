import { useState, useMemo, useCallback } from 'react';
import type { PaginationState, PaginationActions, ParticipantData } from '../components/layouts/types';

export interface UsePaginationResult<T> extends PaginationState, PaginationActions {
  items: T[];
  allItems: T[];
}

export function usePagination<T>(
  items: T[],
  itemsPerPage: number
): UsePaginationResult<T> {
  const [currentPage, setCurrentPage] = useState(1);

  const totalItems = items.length;
  const totalPages = Math.max(Math.ceil(totalItems / itemsPerPage), 1);

  const validCurrentPage = useMemo(() => {
    if (currentPage > totalPages) {
      return totalPages;
    }
    if (currentPage < 1) {
      return 1;
    }
    return currentPage;
  }, [currentPage, totalPages]);

  if (validCurrentPage !== currentPage) {
    setCurrentPage(validCurrentPage);
  }

  const paginatedItems = useMemo(() => {
    const startIndex = (validCurrentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return items.slice(startIndex, endIndex);
  }, [items, validCurrentPage, itemsPerPage]);

  const nextPage = useCallback(() => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  }, []);

  const goToPage = useCallback(
    (page: number) => {
      const validPage = Math.max(1, Math.min(page, totalPages));
      setCurrentPage(validPage);
    },
    [totalPages]
  );

  return {
    items: paginatedItems,
    allItems: items,
    currentPage: validCurrentPage,
    totalPages,
    itemsPerPage,
    totalItems,
    hasNextPage: validCurrentPage < totalPages,
    hasPrevPage: validCurrentPage > 1,
    nextPage,
    prevPage,
    goToPage,
  };
}

export function useParticipantPagination(
  participants: ParticipantData[],
  maxTiles: number
): UsePaginationResult<ParticipantData> {
  return usePagination(participants, maxTiles);
}

