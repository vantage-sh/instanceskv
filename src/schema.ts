import {
    value,
    pipe,
    number,
    object,
    string,
    array,
    any,
    boolean,
    record,
} from "valibot";

export default object({
    version: pipe(number(), value(1, "Version must be 1")),
    filter: string(),
    columns: array(
        object({
            id: string(),
            value: any(),
        }),
    ),
    pricingUnit: string(),
    costDuration: string(),
    region: string(),
    reservedTerm: string(),
    compareOn: boolean(),
    selected: array(string()),
    visibleColumns: record(string(), boolean()),
    sort: array(
        object({
            desc: boolean(),
            id: string(),
        }),
    ),
});
