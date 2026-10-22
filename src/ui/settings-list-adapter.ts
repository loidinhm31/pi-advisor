import { Key, matchesKey } from "@earendil-works/pi-tui";
import type {
  Component,
  Focusable,
  Input,
  SettingItem,
  SettingsList,
} from "@earendil-works/pi-tui";

import type { SettingsListPublicAdapterContract } from "./types.ts";

interface SettingsListPrivateFields {
  filteredItems: SettingItem[];
  searchInput?: Input;
  selectedIndex: number;
  submenuComponent?: Component | null;
}

type SettingsListWithPrivateFields = SettingsList & SettingsListPrivateFields;

const hasSettingsListPublicContract = (
  list: SettingsList
): list is SettingsList & SettingsListPublicAdapterContract => {
  // SAFETY: SettingsList is a non-null object; narrowing checks whether OMP's public methods exist.
  const candidate = list as SettingsList &
    Partial<SettingsListPublicAdapterContract>;
  return (
    typeof candidate.getSelectedItem === "function" &&
    typeof candidate.hasOpenSubmenu === "function" &&
    typeof candidate.hasSearchQuery === "function" &&
    typeof candidate.selectItem === "function" &&
    typeof candidate.updateValue === "function"
  );
};
interface SubmenuHostContract {
  debugChildren?: readonly Component[];
  openSubmenu?: { component?: Component };
}

type SettingsListWithSubmenu = SettingsList & SubmenuHostContract;

const resolveOpenSubmenuComponent = (list: SettingsList): Component | null => {
  // SAFETY: host SettingsList in OMP attaches openSubmenu or debugChildren.
  const host = list as SettingsListWithSubmenu;
  if (host.openSubmenu?.component) {
    return host.openSubmenu.component;
  }
  if (Array.isArray(host.debugChildren) && host.debugChildren.length > 0) {
    return host.debugChildren[0] ?? null;
  }
  return null;
};

const nextSettingValue = (
  item: SettingItem | undefined,
  direction: number
): string | undefined => {
  if (!item?.values?.length) {
    return undefined;
  }
  const currentIndex = item.values.indexOf(item.currentValue);
  let nextIndex: number;
  if (currentIndex === -1) {
    nextIndex = direction > 0 ? 0 : item.values.length - 1;
  } else {
    nextIndex =
      (currentIndex + direction + item.values.length) % item.values.length;
  }
  return item.values[nextIndex];
};

/**
 * Contains the narrow compatibility access needed for pi-tui's SettingsList.
 * No other UI module should depend on its private fields.
 */
export class SettingsListAdapter {
  private readonly list: SettingsList;

  constructor(list: SettingsList) {
    this.list = list;
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    return this.list.render(width);
  }

  handleInput(keyData: string): void {
    this.list.handleInput(keyData);
  }

  /** Compatibility-only view for existing component integration seams. */
  get submenuComponent(): Component | null | undefined {
    if (hasSettingsListPublicContract(this.list)) {
      return resolveOpenSubmenuComponent(this.list);
    }
    return this.privateFields().submenuComponent;
  }

  setFocused(value: boolean): void {
    if (hasSettingsListPublicContract(this.list)) {
      // SAFETY: a SettingsList submenu component is registered only when focusable.
      const submenu = resolveOpenSubmenuComponent(this.list) as
        Focusable | null | undefined;
      if (submenu) {
        submenu.focused = value;
      }
      return;
    }
    const fields = this.privateFields();
    // SAFETY: a SettingsList submenu component is registered only when focusable.
    const submenu = fields.submenuComponent as Focusable | undefined;

    if (submenu) {
      submenu.focused = value;
    }
  }

  setSelectedId(items: SettingItem[], selectedId: string): void {
    if (hasSettingsListPublicContract(this.list)) {
      this.list.selectItem(selectedId);
      return;
    }
    const selectedIndex = items.findIndex((item) => item.id === selectedId);

    if (selectedIndex !== -1) {
      this.privateFields().selectedIndex = selectedIndex;
    }
  }

  changeWithArrow(
    keyData: string,
    onChange: (id: string, value: string) => void
  ): boolean {
    let direction = 0;

    if (matchesKey(keyData, Key.left) || keyData === "\u001B[D") {
      direction = -1;
    } else if (matchesKey(keyData, Key.right) || keyData === "\u001B[C") {
      direction = 1;
    }

    if (direction === 0) {
      return false;
    }

    if (hasSettingsListPublicContract(this.list)) {
      if (this.list.hasOpenSubmenu() || this.list.hasSearchQuery()) {
        return false;
      }
      const item = this.list.getSelectedItem();
      const nextValue = nextSettingValue(item, direction);
      if (!item || nextValue === undefined) {
        return false;
      }
      this.list.updateValue(item.id, nextValue);
      item.currentValue = nextValue;
      onChange(item.id, nextValue);
      return true;
    }

    const fields = this.privateFields();

    if (fields.submenuComponent || fields.searchInput?.getValue()) {
      return false;
    }

    const item = fields.filteredItems[fields.selectedIndex];
    const nextValue = nextSettingValue(item, direction);
    if (!item || nextValue === undefined) {
      return false;
    }

    item.currentValue = nextValue;
    onChange(item.id, nextValue);

    return true;
  }

  private privateFields(): SettingsListPrivateFields {
    // SAFETY: compatibility-only read of SettingsList's private layout fields.
    return this.list as SettingsListWithPrivateFields;
  }
}
