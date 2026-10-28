import { setUi } from "../../store/ui";
import { Icon } from "../common/Icon";

/** Ouvre le sélecteur rapide (Ctrl+K). */
export function SearchButton() {
  return (
    <button class="search-button" onClick={() => setUi("quickSwitcher", true)}>
      <Icon name="search" size={15} />
      Go to…
      <kbd>Ctrl K</kbd>
    </button>
  );
}
