import { Schema, model, models, type Model } from "mongoose";
import { DROPDOWN_TYPES, type DropdownType } from "@/lib/types";

export type { DropdownType };
export { DROPDOWN_TYPES };

export interface IDropdown {
  _id: string;
  type: DropdownType;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

const dropdownSchema = new Schema<IDropdown>(
  {
    type: {
      type: String,
      required: true,
      enum: [...DROPDOWN_TYPES],
      index: true,
    },
    value: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

dropdownSchema.index({ type: 1, value: 1 }, { unique: true });

export const Dropdown: Model<IDropdown> =
  models.Dropdown ?? model<IDropdown>("Dropdown", dropdownSchema);
