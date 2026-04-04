import { useMemo } from "react";

interface ItemWithDate {
  createdAt: Date | string | null;
}

interface DateGroup<T> {
  label: string;
  items: T[];
}

const isToday = (date: Date): boolean => {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
};

const isYesterday = (date: Date): boolean => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  );
};

const isThisWeek = (date: Date): boolean => {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  return date >= weekStart && !isToday(date) && !isYesterday(date);
};

const isThisMonth = (date: Date): boolean => {
  const now = new Date();
  return (
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear() &&
    !isThisWeek(date) &&
    !isToday(date) &&
    !isYesterday(date)
  );
};

/**
 * Groups items by date ranges: Today, Yesterday, This week, This month, Older
 * Items must have a `createdAt` property (Date or string)
 */
export function useDateGroups<T extends ItemWithDate>(
  items: T[],
): DateGroup<T>[] {
  return useMemo(() => {
    const today: T[] = [];
    const yesterday: T[] = [];
    const thisWeek: T[] = [];
    const thisMonth: T[] = [];
    const older: T[] = [];

    for (const item of items) {
      if (item.createdAt === null) {
        older.push(item);
        continue;
      }

      const date =
        typeof item.createdAt === "string"
          ? new Date(item.createdAt)
          : item.createdAt;

      if (isToday(date)) {
        today.push(item);
      } else if (isYesterday(date)) {
        yesterday.push(item);
      } else if (isThisWeek(date)) {
        thisWeek.push(item);
      } else if (isThisMonth(date)) {
        thisMonth.push(item);
      } else {
        older.push(item);
      }
    }

    return [
      { label: "Today", items: today },
      { label: "Yesterday", items: yesterday },
      { label: "This week", items: thisWeek },
      { label: "This month", items: thisMonth },
      { label: "Older", items: older },
    ];
  }, [items]);
}
