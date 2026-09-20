import { useEffect, useState } from 'react';
import { Combobox, NumberInput, useCombobox } from '@mantine/core';

const PRESETS = [0, 0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 8, 10, 12, 15, 20, 60];

/** One editable distance, with optional quick values independent of profile face widths. */
export function PanelGapInput({ value, onChange, label = 'Зазор между панелями (мм)' }: {
  value: number | null;
  onChange: (value: number) => void;
  label?: string;
}) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const [draft, setDraft] = useState<number | string>(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return <Combobox store={combobox} onOptionSubmit={option => {
    const next = Number(option);
    setDraft(next); onChange(next); combobox.closeDropdown();
  }}>
    <Combobox.Target>
      <NumberInput size="xs" label={label} placeholder={value === null ? 'Разные значения' : 'Введите зазор'}
        value={draft} min={0} max={100} allowNegative={false} decimalScale={2}
        decimalSeparator="," allowedDecimalSeparators={['.', ',']} hideControls withKeyboardEvents={false}
        rightSection={<Combobox.Chevron />} rightSectionPointerEvents="none"
        onFocus={() => combobox.openDropdown()} onClick={() => combobox.openDropdown()}
        onBlur={() => { combobox.closeDropdown(); if (draft === '') setDraft(value ?? ''); }}
        onChange={next => {
          setDraft(next);
          if (typeof next === 'number' && Number.isFinite(next) && next >= 0 && next <= 100) onChange(next);
        }} />
    </Combobox.Target>
    <Combobox.Dropdown>
      <Combobox.Options style={{ maxHeight: 220, overflowY: 'auto' }}>
        {PRESETS.map(preset => <Combobox.Option key={preset} value={String(preset)}>
          {preset.toLocaleString('ru-RU')} мм
        </Combobox.Option>)}
      </Combobox.Options>
    </Combobox.Dropdown>
  </Combobox>;
}
