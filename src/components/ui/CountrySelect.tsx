"use client";

import { useLocale } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { inputClass } from "@/components/ui/field-styles";
import {
  clampHighlightedIndex,
  type Country,
  filterCountriesByQuery,
  getCountryName,
} from "@/lib/countries";

// A searchable country combobox, replacing what used to be a plain
// native <select> the visitor had to scroll through -- see CLAUDE.md's
// own "src/lib/countries.ts" section for why (the full ~194-country
// world list this now filters over). The filtering itself lives in
// filterCountriesByQuery() (src/lib/countries.ts), so this component is
// only responsible for the text field/dropdown/keyboard interaction, not
// the matching logic -- same "pure helper in lib, UI in the component"
// split this app already uses elsewhere.
//
// A real ARIA combobox (role="combobox" on the input, role="listbox" on
// the results, aria-activedescendant tracking the highlighted option),
// not just a visually-filtered list -- arrow keys move the highlight,
// Enter selects it, Escape/an outside click closes the dropdown and
// reverts the field to the currently selected country's name.
//
// The displayed text while CLOSED is deliberately never stored in state
// -- it's derived at render time from `value`/locale (`selected ? ... :
// ""`), not synced via a useEffect, which is exactly the
// react-hooks/set-state-in-effect trap this codebase already documents
// working around elsewhere (ParametresForm's pseudo check,
// ProduitCheckoutContent's mount effect) -- deriving instead of syncing
// sidesteps it entirely rather than needing a setTimeout(fn, 0). `query`
// only ever holds the OPEN state's in-progress search text, and only
// ever changes from a direct event handler (typing, focusing, selecting),
// never from an effect reacting to a changing dependency.
export function CountrySelect({
  countries,
  value,
  onChange,
  noResultsLabel,
  className,
}: {
  countries: Country[];
  value: string;
  onChange: (code: string) => void;
  noResultsLabel: string;
  className?: string;
}) {
  const locale = useLocale();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = countries.find((country) => country.code === value) ?? null;
  const selectedName = selected ? getCountryName(selected, locale) : "";

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const displayedValue = isOpen ? query : selectedName;
  const results = isOpen ? filterCountriesByQuery(countries, query, locale) : [];

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  function openWithCurrentSelection() {
    setIsOpen(true);
    setQuery(selectedName);
    setHighlightedIndex(0);
  }

  function selectCountry(country: Country) {
    onChange(country.code);
    setIsOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openWithCurrentSelection();
        return;
      }
      setHighlightedIndex((index) => clampHighlightedIndex(index, 1, results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openWithCurrentSelection();
        return;
      }
      setHighlightedIndex((index) => clampHighlightedIndex(index, -1, results.length));
    } else if (event.key === "Enter") {
      if (isOpen && results[highlightedIndex]) {
        event.preventDefault();
        selectCountry(results[highlightedIndex]);
      }
    } else if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
      }
    }
  }

  const activeOptionId =
    isOpen && results[highlightedIndex] ? `${listboxId}-${results[highlightedIndex].code}` : undefined;

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <input
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        value={displayedValue}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={openWithCurrentSelection}
        onKeyDown={handleKeyDown}
        className={`${inputClass} w-full`}
      />
      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="card absolute z-20 mt-1 max-h-60 w-full overflow-y-auto p-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-foreground-muted">{noResultsLabel}</li>
          ) : (
            results.map((country, index) => (
              <li
                key={country.code}
                id={`${listboxId}-${country.code}`}
                role="option"
                aria-selected={country.code === value}
                onMouseDown={(event) => {
                  // Prevents the input from ever blurring on this click --
                  // without this, the blur would fire before selectCountry()
                  // does, racing the outside-click listener above.
                  event.preventDefault();
                  selectCountry(country);
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`cursor-pointer rounded-xl px-3 py-2 text-sm ${
                  index === highlightedIndex ? "bg-brand-500/15 text-brand-600" : ""
                }`}
              >
                {getCountryName(country, locale)} {country.dial && `(${country.dial})`}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
