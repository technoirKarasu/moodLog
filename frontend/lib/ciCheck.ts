// CIが赤くなることの確認用（#14）。マージしない
import { useState } from "react";

export function useCiCheck(flag: boolean) {
  if (flag) {
    useState(0);
  }
}
