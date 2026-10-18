/** Pure wire association only. Durable journal, ownership and atomic mutation remain host obligations. */
import Ajv from "ajv/dist/2020.js";
import schema from "./p1.schema.json";
import { assertBudget, matchCommittedReceipt } from "./skill-update-review";
const ajv = new Ajv({
  strict: false,
  allErrors: true,
  logger: false,
  ownProperties: true,
});
ajv.addSchema(schema);
function shape(name: string, value: any) {
  assertBudget(value, 2097152, 48, 50000);
  const check = ajv.getSchema(schema.$id + "#/$defs/" + name);
  if (!check || !check(value))
    throw Error("Skill recovery format invalid: " + name);
  return value;
}
export function validateSkillUpdateApplication(value: any): any {
  shape("SkillUpdateApplication", value);
  if (value.status === "applied")
    matchCommittedReceipt(value.input, value.receipt);
  return value;
}
export function validateSkillUpdateDetail(value: any): any {
  shape("SkillUpdateDetail", value);
  const a = value.application,
    s = value.proposal;
  if (a) {
    validateSkillUpdateApplication(a);
    if (
      a.input.proposalId !== s.id ||
      a.input.revision > s.revision ||
      (a.receipt && a.receipt.revisionAfter > s.revision)
    )
      throw Error("Skill recovery proposal or revision changed");
  }
  return value;
}
