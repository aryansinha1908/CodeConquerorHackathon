import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { FieldError, FormSection, IconButton, SmallButton } from './FormBits';
import {
  CHECKLIST_ITEM_MAX,
  CHECKLIST_ITEM_MIN,
  CHECKLIST_MAX,
  addChecklistItem,
  fieldDomId,
  moveChecklistItem,
  removeChecklistItem,
  updateChecklistItem,
} from './listingForm';
import { hintClass, inputClass, labelClass } from './styles';
import { useFocusAfterRender } from './useFocusAfterRender';

// The condition checklist (frontend.md §6.3, §9: 1–10 items of 2–80 characters): the items every
// check-in, check-out and return check answers one by one, in this order.

const EXAMPLES = ['Nozzle clean', 'Build plate undamaged', 'Cables and charger present', 'Area left clean'];

export function ChecklistSection({ form, update, errors, errorCount, changed }) {
  const setFocusTarget = useFocusAfterRender();

  const list = form.checklist;
  const setList = (checklist) => update((f) => ({ ...f, checklist }));
  const full = list.length >= CHECKLIST_MAX;
  const listId = fieldDomId('checklist');
  const listError = errors.checklist;

  const add = (label = '') => {
    if (full) return;
    const next = addChecklistItem(list, label);
    setList(next);
    setFocusTarget(fieldDomId(`checklist.${next.length - 1}`));
  };
  const remove = (key, index) => {
    setList(removeChecklistItem(list, key));
    const left = list.length - 1;
    setFocusTarget(left > 0 ? fieldDomId(`checklist.${Math.min(index, left - 1)}`) : 'add-checklist-item');
  };
  const move = (key, index, delta) => {
    setList(moveChecklistItem(list, key, delta));
    setFocusTarget(`checklist-move-${delta < 0 ? 'up' : 'down'}-${index + delta}`);
  };
  const unused = EXAMPLES.filter((example) => !list.some((item) => item.label.trim().toLowerCase() === example.toLowerCase()));

  return (
    <FormSection
      id="section-checklist"
      title="Condition checklist"
      description="What the borrower and your staff check at every handover. Each check-in, check-out and return answers every item."
      errorCount={errorCount}
      changed={changed}
    >
      <div
        id={listId}
        tabIndex={-1}
        role="group"
        aria-labelledby={`${listId}-label`}
        aria-describedby={[`${listId}-hint`, listError && `${listId}-error`].filter(Boolean).join(' ')}
        className="space-y-3 focus:outline-none"
      >
        <p id={`${listId}-label`} className={labelClass}>
          Items ({list.length} of {CHECKLIST_MAX})
        </p>
        <p id={`${listId}-hint`} className={hintClass}>
          1–{CHECKLIST_MAX} short items of {CHECKLIST_ITEM_MIN}–{CHECKLIST_ITEM_MAX} characters, each different.
        </p>
        <FieldError id={`${listId}-error`} message={listError} />
        {list.length > 0 && (
          <ol className="space-y-2">
            {list.map((item, index) => {
              const path = `checklist.${index}`;
              const id = fieldDomId(path);
              const error = errors[path];
              const name = `Item ${index + 1}`;
              return (
                <li key={item.key} className="space-y-1">
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <label htmlFor={id} className="text-xs font-bold w-14 shrink-0">
                      {name}
                    </label>
                    <input
                      id={id}
                      value={item.label}
                      maxLength={CHECKLIST_ITEM_MAX}
                      onChange={(event) => setList(updateChecklistItem(list, item.key, event.target.value))}
                      aria-invalid={error ? 'true' : undefined}
                      aria-describedby={error ? `${id}-error` : undefined}
                      className={`${inputClass(error)} flex-1 min-w-[10rem]`}
                    />
                    <div className="flex gap-1">
                      <IconButton
                        id={`checklist-move-up-${index}`}
                        icon={ArrowUp}
                        label={`Move ${name} up`}
                        aria-disabled={index === 0 || undefined}
                        onClick={() => index > 0 && move(item.key, index, -1)}
                      />
                      <IconButton
                        id={`checklist-move-down-${index}`}
                        icon={ArrowDown}
                        label={`Move ${name} down`}
                        aria-disabled={index === list.length - 1 || undefined}
                        onClick={() => index < list.length - 1 && move(item.key, index, 1)}
                      />
                      <IconButton icon={Trash2} tone="danger" label={`Remove ${name}`} onClick={() => remove(item.key, index)} />
                    </div>
                  </div>
                  <FieldError id={`${id}-error`} message={error} />
                </li>
              );
            })}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          <SmallButton id="add-checklist-item" aria-disabled={full || undefined} onClick={() => add()}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {full ? `${CHECKLIST_MAX} items, the most allowed` : 'Add an item'}
          </SmallButton>
        </div>
        {!full && unused.length > 0 && (
          <div className="space-y-1">
            <p className={hintClass}>Common items:</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add a common item">
              {unused.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => add(example)}
                  className="text-[11px] px-2 py-1.5 min-h-[32px] rounded-md border-2 border-[#1a1a1a]/40 bg-white hover:border-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
                >
                  + {example}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </FormSection>
  );
}
