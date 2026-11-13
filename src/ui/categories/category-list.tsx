import { cn } from "cn";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { CategoryWithUsage } from "@/business/categories";
import type { BookingType } from "@/business/model";
import { m } from "@/paraglide/messages.js";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/components/ui/alert-dialog";
import { Button } from "@/ui/components/ui/button";
import { Checkbox } from "@/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Label } from "@/ui/components/ui/label";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/ui/table";
import { toast } from "@/ui/components/ui/toast";

import { CategoryForm } from "./category-form";
import { CATEGORY_GROUP_TITLES, positionDisplay } from "./category-messages";
import {
  archivedCount,
  canArchive,
  canDelete,
  type CategoryGroup,
  groupCategories,
} from "./category-model";
import { useCategoryMutations } from "./category-mutations";

/** What the form dialog shows. */
type FormState =
  | { readonly mode: "create"; readonly type: BookingType }
  | { readonly mode: "edit"; readonly category: CategoryWithUsage };

/**
 * The category management (#19): one table per type (income, expense) with
 * name, flags, EÜR position (display name plus the line of `year`), booking
 * count and actions. Archived categories are hidden by default; the toggle
 * shows them muted at the end of their group.
 *
 * Create/edit opens {@link CategoryForm} in a dialog; archiving/reactivating
 * acts immediately (reversible) with a toast; deleting asks first and is only
 * offered for unused non-system categories.
 */
export function CategoryList({
  categories,
  year,
}: Readonly<{ categories: readonly CategoryWithUsage[]; year: number }>) {
  const [showArchived, setShowArchived] = useState(false);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<CategoryWithUsage | null>(null);
  const archived = archivedCount(categories);
  const toggleId = useId();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <Checkbox
          id={toggleId}
          checked={showArchived}
          disabled={archived === 0}
          onCheckedChange={(checked) => setShowArchived(checked)}
        />
        <Label htmlFor={toggleId}>{m.categories_show_archived({ count: String(archived) })}</Label>
      </div>

      {groupCategories(categories).map((group) => (
        <CategoryGroupSection
          key={group.type}
          group={group}
          year={year}
          showArchived={showArchived}
          onCreate={() => setFormState({ mode: "create", type: group.type })}
          onEdit={(category) => setFormState({ mode: "edit", category })}
          onDelete={setDeleting}
        />
      ))}

      <CategoryFormDialog state={formState} year={year} onClose={() => setFormState(null)} />
      <DeleteCategoryDialog category={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function CategoryGroupSection({
  group,
  year,
  showArchived,
  onCreate,
  onEdit,
  onDelete,
}: Readonly<{
  group: CategoryGroup;
  year: number;
  showArchived: boolean;
  onCreate: () => void;
  onEdit: (category: CategoryWithUsage) => void;
  onDelete: (category: CategoryWithUsage) => void;
}>) {
  const headingId = useId();
  const rows = showArchived ? [...group.active, ...group.archived] : group.active;
  const title = CATEGORY_GROUP_TITLES[group.type]();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="font-heading text-lg font-semibold">
          {title}
        </h2>
        <Button variant="outline" size="sm" onClick={onCreate}>
          {group.type === "income" ? m.categories_new_income() : m.categories_new_expense()}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.categories_group_empty()}</p>
      ) : (
        <Table className="table-fixed">
          <TableCaption className="sr-only">{title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[32%]">{m.categories_column_name()}</TableHead>
              <TableHead>{m.categories_column_position({ year: String(year) })}</TableHead>
              <TableHead className="w-24 text-right">{m.categories_column_bookings()}</TableHead>
              <TableHead className="w-32">
                <span className="sr-only">{m.categories_column_actions()}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                year={year}
                onEdit={() => onEdit(category)}
                onDelete={() => onDelete(category)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function Badge({ children, title }: Readonly<{ children: string; title?: string }>) {
  return (
    <span
      title={title}
      className="shrink-0 rounded-sm bg-muted px-1 text-xs font-normal text-muted-foreground"
    >
      {children}
    </span>
  );
}

function CategoryRow({
  category,
  year,
  onEdit,
  onDelete,
}: Readonly<{
  category: CategoryWithUsage;
  year: number;
  onEdit: () => void;
  onDelete: () => void;
}>) {
  const { archive, reactivate } = useCategoryMutations();
  const position = positionDisplay(category.euerPosition, year);
  const busy = archive.isPending || reactivate.isPending;

  const setArchived = async (archived: boolean) => {
    try {
      const result = archived
        ? await archive.mutateAsync(category.id)
        : await reactivate.mutateAsync(category.id);
      if (result.ok) {
        toast.add({
          title: archived
            ? m.category_archived_toast({ name: category.name })
            : m.category_reactivated_toast({ name: category.name }),
          type: "success",
        });
      } else {
        toast.add({
          title:
            result.reason === "notFound"
              ? m.category_not_found_toast()
              : m.category_system_not_archivable(),
          type: "error",
        });
      }
    } catch (error) {
      console.error("Archiving the category failed", error);
      toast.add({ title: m.category_save_error(), type: "error" });
    }
  };

  const deletable = canDelete(category);
  const deleteHint = category.isSystem
    ? m.category_delete_system_hint()
    : m.category_delete_in_use_hint({ count: String(category.bookingCount) });

  return (
    <TableRow
      data-category-id={category.id}
      className={cn(category.archived && "text-muted-foreground")}
    >
      <TableCell>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={cn("font-medium", category.archived && "font-normal")}>
            {category.name}
          </span>
          {category.reducesIncome && (
            <Badge title={m.categories_flag_reduces_income_title()}>
              {m.categories_flag_reduces_income()}
            </Badge>
          )}
          {category.isSystem && (
            <Badge title={m.categories_flag_system_title()}>{m.categories_flag_system()}</Badge>
          )}
          {category.archived && <Badge>{m.categories_flag_archived()}</Badge>}
        </span>
      </TableCell>
      <TableCell className="whitespace-normal">
        <span title={position.label}>{position.text}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">{category.bookingCount}</TableCell>
      <TableCell>
        <span className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.category_edit_label({ name: category.name })}
            title={m.category_edit()}
            onClick={onEdit}
          >
            <Pencil aria-hidden />
          </Button>
          {canArchive(category) && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={m.category_archive_label({ name: category.name })}
              title={m.category_archive()}
              onClick={() => void setArchived(true)}
            >
              <Archive aria-hidden />
            </Button>
          )}
          {category.archived && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={m.category_reactivate_label({ name: category.name })}
              title={m.category_reactivate()}
              onClick={() => void setArchived(false)}
            >
              <ArchiveRestore aria-hidden />
            </Button>
          )}
          {/* System categories: keeps the other buttons in their columns. */}
          {category.isSystem && !category.archived && <span aria-hidden className="size-7" />}
          {/* The wrapper carries the hint: a disabled button gets no pointer events. */}
          <span title={deletable ? m.category_delete() : deleteHint}>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!deletable}
              aria-label={m.category_delete_label({ name: category.name })}
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 aria-hidden />
            </Button>
          </span>
        </span>
      </TableCell>
    </TableRow>
  );
}

function CategoryFormDialog({
  state,
  year,
  onClose,
}: Readonly<{ state: FormState | null; year: number; onClose: () => void }>) {
  // Keeps the content while the dialog animates out; the popup (and with it
  // the form) unmounts once closed, so every opening starts a fresh form.
  const [shown, setShown] = useState(state);
  if (state && state !== shown) setShown(state);
  const title =
    shown?.mode === "edit"
      ? m.category_edit_title()
      : shown?.type === "income"
        ? m.category_new_income_title()
        : m.category_new_expense_title();
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {shown?.mode === "edit" && <DialogDescription>{shown.category.name}</DialogDescription>}
        </DialogHeader>
        {shown && (
          <CategoryForm
            key={shown.mode === "edit" ? shown.category.id : `new-${shown.type}`}
            category={shown.mode === "edit" ? shown.category : undefined}
            defaultType={shown.mode === "create" ? shown.type : undefined}
            year={year}
            onDone={onClose}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirms and deletes an unused category. The service may still refuse
 * (`inUse` if a booking was created meanwhile, `systemCategory`): then a
 * toast suggests archiving.
 */
function DeleteCategoryDialog({
  category,
  onClose,
}: Readonly<{ category: CategoryWithUsage | null; onClose: () => void }>) {
  const { remove } = useCategoryMutations();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Keeps the name while the dialog animates out.
  const [shown, setShown] = useState(category);
  if (category && category !== shown) setShown(category);

  const confirm = async () => {
    if (!category) return;
    try {
      const result = await remove.mutateAsync(category.id);
      if (result.ok) {
        toast.add({ title: m.category_deleted_toast({ name: category.name }), type: "success" });
      } else {
        toast.add({
          title:
            result.reason === "inUse"
              ? m.category_delete_in_use({ count: String(result.bookingCount) })
              : result.reason === "systemCategory"
                ? m.category_delete_system_hint()
                : m.category_not_found_toast(),
          type: "error",
        });
      }
    } catch (error) {
      console.error("Deleting the category failed", error);
      toast.add({ title: m.category_delete_error(), type: "error" });
    }
    onClose();
  };

  return (
    <AlertDialog
      open={category !== null}
      onOpenChange={(open) => !open && !remove.isPending && onClose()}
    >
      {/* Destructive: the safe choice gets the initial focus. */}
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.category_delete_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.category_delete_description({ name: shown?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={remove.isPending}>
            {m.common_cancel()}
          </AlertDialogCancel>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => void confirm()}>
            {remove.isPending ? m.category_deleting() : m.category_delete_confirm()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
