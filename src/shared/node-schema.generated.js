/* Generated from contracts/p1.schema.json (d9773871e83dcd2a136f00186d9574fa11f326941ef04e4c9e0414f325d66db1). Do not edit. */
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// <stdin>
var node_value_1 = validate53;
var pattern3 = new RegExp("^[a-zA-Z0-9_-]{1,100}$", "u");
var func1 = require_ucs2length().default;
var wrapper0 = { validate: validate55 };
function validate55(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate55.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  const _errs1 = errors;
  if (typeof data !== "string") {
    const err0 = { instancePath, schemaPath: "#/anyOf/0/type", keyword: "type", params: { type: "string" }, message: "must be string" };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
  }
  var _valid0 = _errs1 === errors;
  valid0 = valid0 || _valid0;
  const _errs3 = errors;
  if (!(typeof data == "number")) {
    const err1 = { instancePath, schemaPath: "#/anyOf/1/type", keyword: "type", params: { type: "number" }, message: "must be number" };
    if (vErrors === null) {
      vErrors = [err1];
    } else {
      vErrors.push(err1);
    }
    errors++;
  }
  var _valid0 = _errs3 === errors;
  valid0 = valid0 || _valid0;
  const _errs5 = errors;
  if (typeof data !== "boolean") {
    const err2 = { instancePath, schemaPath: "#/anyOf/2/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
    if (vErrors === null) {
      vErrors = [err2];
    } else {
      vErrors.push(err2);
    }
    errors++;
  }
  var _valid0 = _errs5 === errors;
  valid0 = valid0 || _valid0;
  const _errs7 = errors;
  if (data !== null) {
    const err3 = { instancePath, schemaPath: "#/anyOf/3/type", keyword: "type", params: { type: "null" }, message: "must be null" };
    if (vErrors === null) {
      vErrors = [err3];
    } else {
      vErrors.push(err3);
    }
    errors++;
  }
  var _valid0 = _errs7 === errors;
  valid0 = valid0 || _valid0;
  const _errs9 = errors;
  if (Array.isArray(data)) {
    const len0 = data.length;
    for (let i0 = 0; i0 < len0; i0++) {
      if (!wrapper0.validate(data[i0], { instancePath: instancePath + "/" + i0, parentData: data, parentDataProperty: i0, rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? wrapper0.validate.errors : vErrors.concat(wrapper0.validate.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err4 = { instancePath, schemaPath: "#/anyOf/4/type", keyword: "type", params: { type: "array" }, message: "must be array" };
    if (vErrors === null) {
      vErrors = [err4];
    } else {
      vErrors.push(err4);
    }
    errors++;
  }
  var _valid0 = _errs9 === errors;
  valid0 = valid0 || _valid0;
  if (_valid0) {
    var items1 = true;
  }
  const _errs12 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    for (const key0 in data) {
      if (!wrapper0.validate(data[key0], { instancePath: instancePath + "/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), parentData: data, parentDataProperty: key0, rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? wrapper0.validate.errors : vErrors.concat(wrapper0.validate.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err5 = { instancePath, schemaPath: "#/anyOf/5/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err5];
    } else {
      vErrors.push(err5);
    }
    errors++;
  }
  var _valid0 = _errs12 === errors;
  valid0 = valid0 || _valid0;
  if (_valid0) {
    var props2 = true;
  }
  if (!valid0) {
    const err6 = { instancePath, schemaPath: "#/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
    if (vErrors === null) {
      vErrors = [err6];
    } else {
      vErrors.push(err6);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate55.errors = vErrors;
  evaluated0.props = props2;
  evaluated0.items = items1;
  return errors === 0;
}
validate55.evaluated = { "dynamicProps": true, "dynamicItems": true };
function validate54(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate54.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  const _errs1 = errors;
  if (!validate55(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })) {
    vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
    errors = vErrors.length;
  } else {
    var props0 = validate55.evaluated.props;
    var items0 = validate55.evaluated.items;
  }
  var _valid0 = _errs1 === errors;
  valid0 = valid0 || _valid0;
  const _errs2 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.$ref === void 0) {
      const err0 = { instancePath, schemaPath: "#/anyOf/1/required", keyword: "required", params: { missingProperty: "$ref" }, message: "must have required property '$ref'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "$ref")) {
        const err1 = { instancePath, schemaPath: "#/anyOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
    }
    if (data.$ref !== void 0) {
      let data0 = data.$ref;
      if (typeof data0 === "string") {
        if (func1(data0) > 1e5) {
          const err2 = { instancePath: instancePath + "/$ref", schemaPath: "#/anyOf/1/properties/%24ref/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
      } else {
        const err3 = { instancePath: instancePath + "/$ref", schemaPath: "#/anyOf/1/properties/%24ref/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
    }
  } else {
    const err4 = { instancePath, schemaPath: "#/anyOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err4];
    } else {
      vErrors.push(err4);
    }
    errors++;
  }
  var _valid0 = _errs2 === errors;
  valid0 = valid0 || _valid0;
  if (_valid0) {
    if (props0 !== true) {
      props0 = true;
    }
  }
  if (!valid0) {
    const err5 = { instancePath, schemaPath: "#/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
    if (vErrors === null) {
      vErrors = [err5];
    } else {
      vErrors.push(err5);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate54.errors = vErrors;
  evaluated0.props = props0;
  evaluated0.items = items0;
  return errors === 0;
}
validate54.evaluated = { "dynamicProps": true, "dynamicItems": true };
function validate53(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate53.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.value === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "value")) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err5 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("value" !== data.type) {
        const err7 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "value" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err8 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err9 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err11 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err12 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      }
    }
    if (data.value !== void 0) {
      if (!validate54(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  validate53.errors = vErrors;
  return errors === 0;
}
validate53.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_assert_1 = validate58;
var schema23 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "assert" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "actual": { "$ref": "#/$defs/Value" }, "operator": { "enum": ["equals", "notEquals", "contains", "gt", "exists"] }, "expected": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "actual", "operator", "expected"], "additionalProperties": false };
function validate58(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate58.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.actual === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "actual" }, message: "must have required property 'actual'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.operator === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operator" }, message: "must have required property 'operator'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.expected === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "expected" }, message: "must have required property 'expected'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "actual" || key0 === "operator" || key0 === "expected")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("assert" !== data.type) {
        const err9 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "assert" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err10 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err15 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      }
    }
    if (data.actual !== void 0) {
      if (!validate54(data.actual, { instancePath: instancePath + "/actual", parentData: data, parentDataProperty: "actual", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.operator !== void 0) {
      let data6 = data.operator;
      if (!(data6 === "equals" || data6 === "notEquals" || data6 === "contains" || data6 === "gt" || data6 === "exists")) {
        const err16 = { instancePath: instancePath + "/operator", schemaPath: "#/properties/operator/enum", keyword: "enum", params: { allowedValues: schema23.properties.operator.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.expected !== void 0) {
      if (!validate54(data.expected, { instancePath: instancePath + "/expected", parentData: data, parentDataProperty: "expected", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err17];
    } else {
      vErrors.push(err17);
    }
    errors++;
  }
  validate58.errors = vErrors;
  return errors === 0;
}
validate58.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_http_1 = validate61;
var schema24 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "http" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "url": { "$ref": "#/$defs/Value" }, "method": { "enum": ["GET", "POST", "PUT", "DELETE"] }, "headers": { "$ref": "#/$defs/Value" }, "body": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "url", "method", "headers", "body"], "additionalProperties": false };
var func4 = Object.prototype.hasOwnProperty;
function validate61(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate61.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.url === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "url" }, message: "must have required property 'url'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.method === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.headers === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "headers" }, message: "must have required property 'headers'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.body === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "body" }, message: "must have required property 'body'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func4.call(schema24.properties, key0)) {
        const err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("http" !== data.type) {
        const err10 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "http" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err11 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err15 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err16 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      }
    }
    if (data.url !== void 0) {
      if (!validate54(data.url, { instancePath: instancePath + "/url", parentData: data, parentDataProperty: "url", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.method !== void 0) {
      let data6 = data.method;
      if (!(data6 === "GET" || data6 === "POST" || data6 === "PUT" || data6 === "DELETE")) {
        const err17 = { instancePath: instancePath + "/method", schemaPath: "#/properties/method/enum", keyword: "enum", params: { allowedValues: schema24.properties.method.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.headers !== void 0) {
      if (!validate54(data.headers, { instancePath: instancePath + "/headers", parentData: data, parentDataProperty: "headers", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.body !== void 0) {
      if (!validate54(data.body, { instancePath: instancePath + "/body", parentData: data, parentDataProperty: "body", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err18 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err18];
    } else {
      vErrors.push(err18);
    }
    errors++;
  }
  validate61.errors = vErrors;
  return errors === 0;
}
validate61.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_script_1 = validate65;
var schema25 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "script" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "language": { "enum": ["js", "ts"] }, "code": { "type": "string", "maxLength": 10485760 }, "input": { "$ref": "#/$defs/Value" }, "dependencies": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string", "maxLength": 1e5 }, "version": { "type": "string", "maxLength": 1e5 } }, "required": ["name", "version"], "additionalProperties": false }, "maxItems": 1e3 } }, "required": ["id", "type", "version", "language", "code", "input", "dependencies"], "additionalProperties": false };
function validate65(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate65.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.language === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "language" }, message: "must have required property 'language'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.code === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "code" }, message: "must have required property 'code'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.input === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "input" }, message: "must have required property 'input'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.dependencies === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "dependencies" }, message: "must have required property 'dependencies'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func4.call(schema25.properties, key0)) {
        const err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("script" !== data.type) {
        const err10 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "script" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err11 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err15 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err16 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      }
    }
    if (data.language !== void 0) {
      let data5 = data.language;
      if (!(data5 === "js" || data5 === "ts")) {
        const err17 = { instancePath: instancePath + "/language", schemaPath: "#/properties/language/enum", keyword: "enum", params: { allowedValues: schema25.properties.language.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.code !== void 0) {
      let data6 = data.code;
      if (typeof data6 === "string") {
        if (func1(data6) > 10485760) {
          const err18 = { instancePath: instancePath + "/code", schemaPath: "#/properties/code/maxLength", keyword: "maxLength", params: { limit: 10485760 }, message: "must NOT have more than 10485760 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/code", schemaPath: "#/properties/code/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.input !== void 0) {
      if (!validate54(data.input, { instancePath: instancePath + "/input", parentData: data, parentDataProperty: "input", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.dependencies !== void 0) {
      let data8 = data.dependencies;
      if (Array.isArray(data8)) {
        if (data8.length > 1e3) {
          const err20 = { instancePath: instancePath + "/dependencies", schemaPath: "#/properties/dependencies/maxItems", keyword: "maxItems", params: { limit: 1e3 }, message: "must NOT have more than 1000 items" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
        const len0 = data8.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data9 = data8[i0];
          if (data9 && typeof data9 == "object" && !Array.isArray(data9)) {
            if (data9.name === void 0) {
              const err21 = { instancePath: instancePath + "/dependencies/" + i0, schemaPath: "#/properties/dependencies/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
            if (data9.version === void 0) {
              const err22 = { instancePath: instancePath + "/dependencies/" + i0, schemaPath: "#/properties/dependencies/items/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
              if (vErrors === null) {
                vErrors = [err22];
              } else {
                vErrors.push(err22);
              }
              errors++;
            }
            for (const key1 in data9) {
              if (!(key1 === "name" || key1 === "version")) {
                const err23 = { instancePath: instancePath + "/dependencies/" + i0, schemaPath: "#/properties/dependencies/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err23];
                } else {
                  vErrors.push(err23);
                }
                errors++;
              }
            }
            if (data9.name !== void 0) {
              let data10 = data9.name;
              if (typeof data10 === "string") {
                if (func1(data10) > 1e5) {
                  const err24 = { instancePath: instancePath + "/dependencies/" + i0 + "/name", schemaPath: "#/properties/dependencies/items/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                  if (vErrors === null) {
                    vErrors = [err24];
                  } else {
                    vErrors.push(err24);
                  }
                  errors++;
                }
              } else {
                const err25 = { instancePath: instancePath + "/dependencies/" + i0 + "/name", schemaPath: "#/properties/dependencies/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err25];
                } else {
                  vErrors.push(err25);
                }
                errors++;
              }
            }
            if (data9.version !== void 0) {
              let data11 = data9.version;
              if (typeof data11 === "string") {
                if (func1(data11) > 1e5) {
                  const err26 = { instancePath: instancePath + "/dependencies/" + i0 + "/version", schemaPath: "#/properties/dependencies/items/properties/version/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                  if (vErrors === null) {
                    vErrors = [err26];
                  } else {
                    vErrors.push(err26);
                  }
                  errors++;
                }
              } else {
                const err27 = { instancePath: instancePath + "/dependencies/" + i0 + "/version", schemaPath: "#/properties/dependencies/items/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err27];
                } else {
                  vErrors.push(err27);
                }
                errors++;
              }
            }
          } else {
            const err28 = { instancePath: instancePath + "/dependencies/" + i0, schemaPath: "#/properties/dependencies/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err28];
            } else {
              vErrors.push(err28);
            }
            errors++;
          }
        }
      } else {
        const err29 = { instancePath: instancePath + "/dependencies", schemaPath: "#/properties/dependencies/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err29];
        } else {
          vErrors.push(err29);
        }
        errors++;
      }
    }
  } else {
    const err30 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err30];
    } else {
      vErrors.push(err30);
    }
    errors++;
  }
  validate65.errors = vErrors;
  return errors === 0;
}
validate65.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_file_1 = validate67;
var schema26 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "file" }, "version": { "const": 1 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["read", "write", "copy"] }, "binding": { "type": "string", "maxLength": 1e5 }, "content": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "binding", "name", "content"], "additionalProperties": false };
function validate67(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate67.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.content === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "content" }, message: "must have required property 'content'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "operation" || key0 === "binding" || key0 === "content")) {
        const err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("file" !== data.type) {
        const err10 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "file" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err11 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err12 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      }
    }
    if (data.operation !== void 0) {
      let data5 = data.operation;
      if (!(data5 === "read" || data5 === "write" || data5 === "copy")) {
        const err15 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/enum", keyword: "enum", params: { allowedValues: schema26.properties.operation.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      let data6 = data.binding;
      if (typeof data6 === "string") {
        if (func1(data6) > 1e5) {
          const err16 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.content !== void 0) {
      if (!validate54(data.content, { instancePath: instancePath + "/content", parentData: data, parentDataProperty: "content", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err18 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err18];
    } else {
      vErrors.push(err18);
    }
    errors++;
  }
  validate67.errors = vErrors;
  return errors === 0;
}
validate67.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_excel_1 = validate70;
var schema27 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "excel" }, "version": { "const": 1 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["read", "write"] }, "binding": { "type": "string", "maxLength": 1e5 }, "rows": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "binding", "name", "rows"], "additionalProperties": false };
function validate70(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate70.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.rows === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rows" }, message: "must have required property 'rows'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "operation" || key0 === "binding" || key0 === "rows")) {
        const err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("excel" !== data.type) {
        const err10 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "excel" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err11 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err12 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      }
    }
    if (data.operation !== void 0) {
      let data5 = data.operation;
      if (!(data5 === "read" || data5 === "write")) {
        const err15 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/enum", keyword: "enum", params: { allowedValues: schema27.properties.operation.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      let data6 = data.binding;
      if (typeof data6 === "string") {
        if (func1(data6) > 1e5) {
          const err16 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.rows !== void 0) {
      if (!validate54(data.rows, { instancePath: instancePath + "/rows", parentData: data, parentDataProperty: "rows", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err18 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err18];
    } else {
      vErrors.push(err18);
    }
    errors++;
  }
  validate70.errors = vErrors;
  return errors === 0;
}
validate70.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_excel_2 = validate73;
var schema28 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "excel" }, "version": { "const": 2 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "const": "fill" }, "binding": { "type": "string", "maxLength": 1e5 }, "templateName": { "$ref": "#/$defs/Value" }, "sheet": { "type": "string", "maxLength": 1e5 }, "cells": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "binding", "name", "templateName", "sheet", "cells"], "additionalProperties": false };
function validate73(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate73.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.templateName === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "templateName" }, message: "must have required property 'templateName'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.sheet === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sheet" }, message: "must have required property 'sheet'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.cells === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "cells" }, message: "must have required property 'cells'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func4.call(schema28.properties, key0)) {
        const err9 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err10 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("excel" !== data.type) {
        const err12 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "excel" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (2 !== data.version) {
        const err13 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 2 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err15 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err16 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      }
    }
    if (data.operation !== void 0) {
      if ("fill" !== data.operation) {
        const err17 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/const", keyword: "const", params: { allowedValue: "fill" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      let data6 = data.binding;
      if (typeof data6 === "string") {
        if (func1(data6) > 1e5) {
          const err18 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.templateName !== void 0) {
      if (!validate54(data.templateName, { instancePath: instancePath + "/templateName", parentData: data, parentDataProperty: "templateName", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.sheet !== void 0) {
      let data8 = data.sheet;
      if (typeof data8 === "string") {
        if (func1(data8) > 1e5) {
          const err20 = { instancePath: instancePath + "/sheet", schemaPath: "#/properties/sheet/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      } else {
        const err21 = { instancePath: instancePath + "/sheet", schemaPath: "#/properties/sheet/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.cells !== void 0) {
      if (!validate54(data.cells, { instancePath: instancePath + "/cells", parentData: data, parentDataProperty: "cells", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err22 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err22];
    } else {
      vErrors.push(err22);
    }
    errors++;
  }
  validate73.errors = vErrors;
  return errors === 0;
}
validate73.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_file_2 = validate77;
function validate77(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate77.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.files === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "files" }, message: "must have required property 'files'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "operation" || key0 === "binding" || key0 === "files")) {
        const err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("file" !== data.type) {
        const err10 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "file" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (2 !== data.version) {
        const err11 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 2 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err12 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      }
    }
    if (data.operation !== void 0) {
      if ("archive" !== data.operation) {
        const err15 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/const", keyword: "const", params: { allowedValue: "archive" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      let data6 = data.binding;
      if (typeof data6 === "string") {
        if (func1(data6) > 1e5) {
          const err16 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.files !== void 0) {
      if (!validate54(data.files, { instancePath: instancePath + "/files", parentData: data, parentDataProperty: "files", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err18 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err18];
    } else {
      vErrors.push(err18);
    }
    errors++;
  }
  validate77.errors = vErrors;
  return errors === 0;
}
validate77.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_browser_1 = validate80;
var schema30 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "browser" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["navigate", "read", "click", "fill", "wait", "upload", "screenshot", "download"] }, "selector": { "type": "string", "maxLength": 1e5 }, "value": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "selector", "value"], "additionalProperties": false };
function validate80(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate80.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.selector === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "selector" }, message: "must have required property 'selector'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.value === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "operation" || key0 === "selector" || key0 === "value")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("browser" !== data.type) {
        const err9 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "browser" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err10 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err15 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      }
    }
    if (data.operation !== void 0) {
      let data5 = data.operation;
      if (!(data5 === "navigate" || data5 === "read" || data5 === "click" || data5 === "fill" || data5 === "wait" || data5 === "upload" || data5 === "screenshot" || data5 === "download")) {
        const err16 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/enum", keyword: "enum", params: { allowedValues: schema30.properties.operation.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.selector !== void 0) {
      let data6 = data.selector;
      if (typeof data6 === "string") {
        if (func1(data6) > 1e5) {
          const err17 = { instancePath: instancePath + "/selector", schemaPath: "#/properties/selector/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      } else {
        const err18 = { instancePath: instancePath + "/selector", schemaPath: "#/properties/selector/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.value !== void 0) {
      if (!validate54(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err19 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err19];
    } else {
      vErrors.push(err19);
    }
    errors++;
  }
  validate80.errors = vErrors;
  return errors === 0;
}
validate80.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_browser_2 = validate82;
var schema31 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "browser" }, "version": { "const": 2 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["navigate", "read", "click", "fill", "wait", "upload", "screenshot", "download"] }, "selector": { "type": "string", "maxLength": 1e5 }, "value": { "$ref": "#/$defs/Value" }, "framePath": { "$ref": "#/$defs/FramePath" } }, "required": ["id", "type", "version", "operation", "selector", "value", "framePath"], "additionalProperties": false, "allOf": [{ "if": { "properties": { "operation": { "enum": ["navigate", "screenshot"] } } }, "then": { "properties": { "framePath": { "maxItems": 0 } } } }] };
var pattern13 = new RegExp("\\S", "u");
function validate84(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate84.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (Array.isArray(data)) {
    if (data.length > 8) {
      const err0 = { instancePath, schemaPath: "#/maxItems", keyword: "maxItems", params: { limit: 8 }, message: "must NOT have more than 8 items" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    const len0 = data.length;
    for (let i0 = 0; i0 < len0; i0++) {
      let data0 = data[i0];
      if (typeof data0 === "string") {
        if (func1(data0) > 2e3) {
          const err1 = { instancePath: instancePath + "/" + i0, schemaPath: "#/items/maxLength", keyword: "maxLength", params: { limit: 2e3 }, message: "must NOT have more than 2000 characters" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (func1(data0) < 1) {
          const err2 = { instancePath: instancePath + "/" + i0, schemaPath: "#/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (!pattern13.test(data0)) {
          const err3 = { instancePath: instancePath + "/" + i0, schemaPath: "#/items/pattern", keyword: "pattern", params: { pattern: "\\S" }, message: 'must match pattern "\\S"' };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      } else {
        const err4 = { instancePath: instancePath + "/" + i0, schemaPath: "#/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
  } else {
    const err5 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "array" }, message: "must be array" };
    if (vErrors === null) {
      vErrors = [err5];
    } else {
      vErrors.push(err5);
    }
    errors++;
  }
  validate84.errors = vErrors;
  return errors === 0;
}
validate84.evaluated = { "items": true, "dynamicProps": false, "dynamicItems": false };
function validate82(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate82.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.operation !== void 0) {
      let data0 = data.operation;
      if (!(data0 === "navigate" || data0 === "screenshot")) {
        const err0 = {};
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.framePath !== void 0) {
        let data1 = data.framePath;
        if (Array.isArray(data1)) {
          if (data1.length > 0) {
            const err1 = { instancePath: instancePath + "/framePath", schemaPath: "#/allOf/0/then/properties/framePath/maxItems", keyword: "maxItems", params: { limit: 0 }, message: "must NOT have more than 0 items" };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
    if (valid1) {
      var props0 = {};
      props0.framePath = true;
      props0.operation = true;
    }
  }
  if (!valid1) {
    const err2 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err2];
    } else {
      vErrors.push(err2);
    }
    errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.selector === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "selector" }, message: "must have required property 'selector'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.value === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.framePath === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "framePath" }, message: "must have required property 'framePath'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func4.call(schema31.properties, key0)) {
        const err10 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern3.test(data2)) {
          const err11 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("browser" !== data.type) {
        const err13 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "browser" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (2 !== data.version) {
        const err14 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 2 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data5 = data.name;
      if (typeof data5 === "string") {
        if (func1(data5) > 1e5) {
          const err15 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data6 = data.timeoutMs;
      if (!(typeof data6 == "number" && (!(data6 % 1) && !isNaN(data6)))) {
        const err17 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      if (typeof data6 == "number") {
        if (data6 > 36e5 || isNaN(data6)) {
          const err18 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        if (data6 < 100 || isNaN(data6)) {
          const err19 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      }
    }
    if (data.operation !== void 0) {
      let data7 = data.operation;
      if (!(data7 === "navigate" || data7 === "read" || data7 === "click" || data7 === "fill" || data7 === "wait" || data7 === "upload" || data7 === "screenshot" || data7 === "download")) {
        const err20 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/enum", keyword: "enum", params: { allowedValues: schema31.properties.operation.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
    if (data.selector !== void 0) {
      let data8 = data.selector;
      if (typeof data8 === "string") {
        if (func1(data8) > 1e5) {
          const err21 = { instancePath: instancePath + "/selector", schemaPath: "#/properties/selector/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err21];
          } else {
            vErrors.push(err21);
          }
          errors++;
        }
      } else {
        const err22 = { instancePath: instancePath + "/selector", schemaPath: "#/properties/selector/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.value !== void 0) {
      if (!validate54(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.framePath !== void 0) {
      if (!validate84(data.framePath, { instancePath: instancePath + "/framePath", parentData: data, parentDataProperty: "framePath", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate84.errors : vErrors.concat(validate84.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err23 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err23];
    } else {
      vErrors.push(err23);
    }
    errors++;
  }
  validate82.errors = vErrors;
  return errors === 0;
}
validate82.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_browser_3 = validate86;
var schema33 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "browser" }, "version": { "const": 3 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["navigate", "read", "click", "fill", "wait", "upload", "screenshot", "download", "select", "check", "inputValue", "press"] }, "selector": { "type": "string", "maxLength": 1e5 }, "value": { "$ref": "#/$defs/Value" }, "framePath": { "$ref": "#/$defs/FramePath" } }, "required": ["id", "type", "version", "operation", "selector", "value", "framePath"], "additionalProperties": false, "allOf": [{ "if": { "properties": { "operation": { "enum": ["navigate", "screenshot"] } } }, "then": { "properties": { "framePath": { "maxItems": 0 } } } }] };
function validate86(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate86.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs2 = errors;
  let valid1 = true;
  const _errs3 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.operation !== void 0) {
      let data0 = data.operation;
      if (!(data0 === "navigate" || data0 === "screenshot")) {
        const err0 = {};
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
    }
  }
  var _valid0 = _errs3 === errors;
  errors = _errs2;
  if (vErrors !== null) {
    if (_errs2) {
      vErrors.length = _errs2;
    } else {
      vErrors = null;
    }
  }
  if (_valid0) {
    const _errs5 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.framePath !== void 0) {
        let data1 = data.framePath;
        if (Array.isArray(data1)) {
          if (data1.length > 0) {
            const err1 = { instancePath: instancePath + "/framePath", schemaPath: "#/allOf/0/then/properties/framePath/maxItems", keyword: "maxItems", params: { limit: 0 }, message: "must NOT have more than 0 items" };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
        }
      }
    }
    var _valid0 = _errs5 === errors;
    valid1 = _valid0;
    if (valid1) {
      var props0 = {};
      props0.framePath = true;
      props0.operation = true;
    }
  }
  if (!valid1) {
    const err2 = { instancePath, schemaPath: "#/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
    if (vErrors === null) {
      vErrors = [err2];
    } else {
      vErrors.push(err2);
    }
    errors++;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.selector === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "selector" }, message: "must have required property 'selector'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.value === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.framePath === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "framePath" }, message: "must have required property 'framePath'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func4.call(schema33.properties, key0)) {
        const err10 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data2 = data.id;
      if (typeof data2 === "string") {
        if (!pattern3.test(data2)) {
          const err11 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("browser" !== data.type) {
        const err13 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "browser" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (3 !== data.version) {
        const err14 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 3 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data5 = data.name;
      if (typeof data5 === "string") {
        if (func1(data5) > 1e5) {
          const err15 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      } else {
        const err16 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data6 = data.timeoutMs;
      if (!(typeof data6 == "number" && (!(data6 % 1) && !isNaN(data6)))) {
        const err17 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      if (typeof data6 == "number") {
        if (data6 > 36e5 || isNaN(data6)) {
          const err18 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        if (data6 < 100 || isNaN(data6)) {
          const err19 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      }
    }
    if (data.operation !== void 0) {
      let data7 = data.operation;
      if (!(data7 === "navigate" || data7 === "read" || data7 === "click" || data7 === "fill" || data7 === "wait" || data7 === "upload" || data7 === "screenshot" || data7 === "download" || data7 === "select" || data7 === "check" || data7 === "inputValue" || data7 === "press")) {
        const err20 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/enum", keyword: "enum", params: { allowedValues: schema33.properties.operation.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
    if (data.selector !== void 0) {
      let data8 = data.selector;
      if (typeof data8 === "string") {
        if (func1(data8) > 1e5) {
          const err21 = { instancePath: instancePath + "/selector", schemaPath: "#/properties/selector/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err21];
          } else {
            vErrors.push(err21);
          }
          errors++;
        }
      } else {
        const err22 = { instancePath: instancePath + "/selector", schemaPath: "#/properties/selector/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.value !== void 0) {
      if (!validate54(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.framePath !== void 0) {
      if (!validate84(data.framePath, { instancePath: instancePath + "/framePath", parentData: data, parentDataProperty: "framePath", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate84.errors : vErrors.concat(validate84.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err23 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err23];
    } else {
      vErrors.push(err23);
    }
    errors++;
  }
  validate86.errors = vErrors;
  return errors === 0;
}
validate86.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_human_1 = validate89;
function validate89(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate89.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.message === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "message" }, message: "must have required property 'message'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "message")) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err5 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("human" !== data.type) {
        const err7 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "human" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err8 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err9 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err11 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err12 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      }
    }
    if (data.message !== void 0) {
      let data5 = data.message;
      if (typeof data5 === "string") {
        if (func1(data5) > 1e5) {
          const err14 = { instancePath: instancePath + "/message", schemaPath: "#/properties/message/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      } else {
        const err15 = { instancePath: instancePath + "/message", schemaPath: "#/properties/message/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
  } else {
    const err16 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err16];
    } else {
      vErrors.push(err16);
    }
    errors++;
  }
  validate89.errors = vErrors;
  return errors === 0;
}
validate89.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_condition_1 = validate90;
var schema35 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "condition" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "actual": { "$ref": "#/$defs/Value" }, "operator": { "enum": ["equals", "notEquals", "contains", "gt", "exists"] }, "expected": { "$ref": "#/$defs/Value" }, "then": { "type": "array", "items": { "$ref": "#/$defs/Node" }, "maxItems": 1e3 }, "else": { "type": "array", "items": { "$ref": "#/$defs/Node" }, "maxItems": 1e3 } }, "required": ["id", "type", "version", "actual", "operator", "expected", "then", "else"], "additionalProperties": false };
var schema36 = { "oneOf": [{ "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "value" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "value": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "value"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "assert" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "actual": { "$ref": "#/$defs/Value" }, "operator": { "enum": ["equals", "notEquals", "contains", "gt", "exists"] }, "expected": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "actual", "operator", "expected"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "http" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "url": { "$ref": "#/$defs/Value" }, "method": { "enum": ["GET", "POST", "PUT", "DELETE"] }, "headers": { "$ref": "#/$defs/Value" }, "body": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "url", "method", "headers", "body"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "script" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "language": { "enum": ["js", "ts"] }, "code": { "type": "string", "maxLength": 10485760 }, "input": { "$ref": "#/$defs/Value" }, "dependencies": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string", "maxLength": 1e5 }, "version": { "type": "string", "maxLength": 1e5 } }, "required": ["name", "version"], "additionalProperties": false }, "maxItems": 1e3 } }, "required": ["id", "type", "version", "language", "code", "input", "dependencies"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "file" }, "version": { "const": 1 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["read", "write", "copy"] }, "binding": { "type": "string", "maxLength": 1e5 }, "content": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "binding", "name", "content"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "excel" }, "version": { "const": 1 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["read", "write"] }, "binding": { "type": "string", "maxLength": 1e5 }, "rows": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "binding", "name", "rows"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "excel" }, "version": { "const": 2 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "const": "fill" }, "binding": { "type": "string", "maxLength": 1e5 }, "templateName": { "$ref": "#/$defs/Value" }, "sheet": { "type": "string", "maxLength": 1e5 }, "cells": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "binding", "name", "templateName", "sheet", "cells"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "file" }, "version": { "const": 2 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "const": "archive" }, "binding": { "type": "string", "maxLength": 1e5 }, "files": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "binding", "name", "files"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "browser" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["navigate", "read", "click", "fill", "wait", "upload", "screenshot", "download"] }, "selector": { "type": "string", "maxLength": 1e5 }, "value": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "selector", "value"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "browser" }, "version": { "const": 2 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["navigate", "read", "click", "fill", "wait", "upload", "screenshot", "download"] }, "selector": { "type": "string", "maxLength": 1e5 }, "value": { "$ref": "#/$defs/Value" }, "framePath": { "$ref": "#/$defs/FramePath" } }, "required": ["id", "type", "version", "operation", "selector", "value", "framePath"], "additionalProperties": false, "allOf": [{ "if": { "properties": { "operation": { "enum": ["navigate", "screenshot"] } } }, "then": { "properties": { "framePath": { "maxItems": 0 } } } }] }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "browser" }, "version": { "const": 3 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "enum": ["navigate", "read", "click", "fill", "wait", "upload", "screenshot", "download", "select", "check", "inputValue", "press"] }, "selector": { "type": "string", "maxLength": 1e5 }, "value": { "$ref": "#/$defs/Value" }, "framePath": { "$ref": "#/$defs/FramePath" } }, "required": ["id", "type", "version", "operation", "selector", "value", "framePath"], "additionalProperties": false, "allOf": [{ "if": { "properties": { "operation": { "enum": ["navigate", "screenshot"] } } }, "then": { "properties": { "framePath": { "maxItems": 0 } } } }] }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "human" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "message": { "type": "string", "maxLength": 1e5 } }, "required": ["id", "type", "version", "message"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "condition" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "actual": { "$ref": "#/$defs/Value" }, "operator": { "enum": ["equals", "notEquals", "contains", "gt", "exists"] }, "expected": { "$ref": "#/$defs/Value" }, "then": { "type": "array", "items": { "$ref": "#/$defs/Node" }, "maxItems": 1e3 }, "else": { "type": "array", "items": { "$ref": "#/$defs/Node" }, "maxItems": 1e3 } }, "required": ["id", "type", "version", "actual", "operator", "expected", "then", "else"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "loop" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "items": { "$ref": "#/$defs/Value" }, "body": { "type": "array", "items": { "$ref": "#/$defs/Node" }, "maxItems": 1e3 } }, "required": ["id", "type", "version", "items", "body"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "excel" }, "version": { "const": 3 }, "operation": { "const": "map" }, "binding": { "type": "string", "minLength": 1, "maxLength": 1e5 }, "name": { "$ref": "#/$defs/Value" }, "sheet": { "type": "string", "minLength": 1, "maxLength": 31 }, "rows": { "$ref": "#/$defs/Value" }, "mappings": { "type": "array", "minItems": 1, "maxItems": 256, "items": { "$ref": "#/$defs/ExcelColumnMapping" } }, "includeHeaders": { "type": "boolean" }, "nullPolicy": { "const": "blank" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 } }, "required": ["id", "type", "version", "operation", "binding", "name", "sheet", "rows", "mappings", "includeHeaders", "nullPolicy"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "file" }, "version": { "const": 3 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "const": "create" }, "binding": { "type": "string", "maxLength": 1e5 }, "content": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "operation", "binding", "name", "content"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "file" }, "version": { "const": 4 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "const": "create" }, "binding": { "type": "string", "maxLength": 1e5 }, "content": { "$ref": "#/$defs/Value" }, "onConflict": { "const": "number" } }, "required": ["id", "type", "version", "operation", "binding", "name", "content", "onConflict"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "mcp" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "target": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "tool": { "type": "string", "minLength": 1, "maxLength": 500 }, "arguments": { "$ref": "#/$defs/Value" } }, "required": ["id", "type", "version", "target", "tool", "arguments"], "additionalProperties": false }, { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "desktop" }, "version": { "const": 1 }, "name": { "type": "string", "maxLength": 1e5 }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 6e4 }, "target": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "operation": { "const": "replace-selection" }, "text": { "type": "string", "minLength": 1, "maxLength": 2e4 } }, "required": ["id", "type", "version", "target", "operation", "text"], "additionalProperties": false }] };
var schema37 = { "type": "object", "properties": { "source": { "type": "string", "minLength": 1, "maxLength": 256 }, "column": { "type": "string", "pattern": "^[A-Z]{1,3}$" }, "header": { "type": "string", "maxLength": 256 }, "type": { "enum": ["text", "number", "boolean"] } }, "required": ["source", "column", "header", "type"], "additionalProperties": false };
var pattern32 = new RegExp("^[A-Z]{1,3}$", "u");
function validate120(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate120.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.source === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.column === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "column" }, message: "must have required property 'column'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.header === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "header" }, message: "must have required property 'header'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "source" || key0 === "column" || key0 === "header" || key0 === "type")) {
        const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.source !== void 0) {
      let data0 = data.source;
      if (typeof data0 === "string") {
        if (func1(data0) > 256) {
          const err5 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        if (func1(data0) < 1) {
          const err6 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.column !== void 0) {
      let data1 = data.column;
      if (typeof data1 === "string") {
        if (!pattern32.test(data1)) {
          const err8 = { instancePath: instancePath + "/column", schemaPath: "#/properties/column/pattern", keyword: "pattern", params: { pattern: "^[A-Z]{1,3}$" }, message: 'must match pattern "^[A-Z]{1,3}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/column", schemaPath: "#/properties/column/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.header !== void 0) {
      let data2 = data.header;
      if (typeof data2 === "string") {
        if (func1(data2) > 256) {
          const err10 = { instancePath: instancePath + "/header", schemaPath: "#/properties/header/maxLength", keyword: "maxLength", params: { limit: 256 }, message: "must NOT have more than 256 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/header", schemaPath: "#/properties/header/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      let data3 = data.type;
      if (!(data3 === "text" || data3 === "number" || data3 === "boolean")) {
        const err12 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/enum", keyword: "enum", params: { allowedValues: schema37.properties.type.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
  } else {
    const err13 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err13];
    } else {
      vErrors.push(err13);
    }
    errors++;
  }
  validate120.errors = vErrors;
  return errors === 0;
}
validate120.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var wrapper2 = { validate: validate93 };
function validate93(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate93.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.value === void 0) {
      const err3 = { instancePath, schemaPath: "#/oneOf/0/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "value")) {
        const err4 = { instancePath, schemaPath: "#/oneOf/0/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err5 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/0/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      } else {
        const err6 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/0/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("value" !== data.type) {
        const err7 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/0/properties/type/const", keyword: "const", params: { allowedValue: "value" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err8 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/0/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err9 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/0/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/0/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err11 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/0/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err12 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/0/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/0/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      }
    }
    if (data.value !== void 0) {
      if (!validate54(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err14 = { instancePath, schemaPath: "#/oneOf/0/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err14];
    } else {
      vErrors.push(err14);
    }
    errors++;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props1 = true;
  }
  const _errs13 = errors;
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err15 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err15];
      } else {
        vErrors.push(err15);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err16 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err16];
      } else {
        vErrors.push(err16);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err17 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err17];
      } else {
        vErrors.push(err17);
      }
      errors++;
    }
    if (data.actual === void 0) {
      const err18 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "actual" }, message: "must have required property 'actual'" };
      if (vErrors === null) {
        vErrors = [err18];
      } else {
        vErrors.push(err18);
      }
      errors++;
    }
    if (data.operator === void 0) {
      const err19 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "operator" }, message: "must have required property 'operator'" };
      if (vErrors === null) {
        vErrors = [err19];
      } else {
        vErrors.push(err19);
      }
      errors++;
    }
    if (data.expected === void 0) {
      const err20 = { instancePath, schemaPath: "#/oneOf/1/required", keyword: "required", params: { missingProperty: "expected" }, message: "must have required property 'expected'" };
      if (vErrors === null) {
        vErrors = [err20];
      } else {
        vErrors.push(err20);
      }
      errors++;
    }
    for (const key1 in data) {
      if (!(key1 === "id" || key1 === "type" || key1 === "version" || key1 === "name" || key1 === "timeoutMs" || key1 === "actual" || key1 === "operator" || key1 === "expected")) {
        const err21 = { instancePath, schemaPath: "#/oneOf/1/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data6 = data.id;
      if (typeof data6 === "string") {
        if (!pattern3.test(data6)) {
          const err22 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/1/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err22];
          } else {
            vErrors.push(err22);
          }
          errors++;
        }
      } else {
        const err23 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/1/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("assert" !== data.type) {
        const err24 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/1/properties/type/const", keyword: "const", params: { allowedValue: "assert" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err25 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/1/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data9 = data.name;
      if (typeof data9 === "string") {
        if (func1(data9) > 1e5) {
          const err26 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/1/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err26];
          } else {
            vErrors.push(err26);
          }
          errors++;
        }
      } else {
        const err27 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/1/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data10 = data.timeoutMs;
      if (!(typeof data10 == "number" && (!(data10 % 1) && !isNaN(data10)))) {
        const err28 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/1/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
      if (typeof data10 == "number") {
        if (data10 > 36e5 || isNaN(data10)) {
          const err29 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/1/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err29];
          } else {
            vErrors.push(err29);
          }
          errors++;
        }
        if (data10 < 100 || isNaN(data10)) {
          const err30 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/1/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
      }
    }
    if (data.actual !== void 0) {
      if (!validate54(data.actual, { instancePath: instancePath + "/actual", parentData: data, parentDataProperty: "actual", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.operator !== void 0) {
      let data12 = data.operator;
      if (!(data12 === "equals" || data12 === "notEquals" || data12 === "contains" || data12 === "gt" || data12 === "exists")) {
        const err31 = { instancePath: instancePath + "/operator", schemaPath: "#/oneOf/1/properties/operator/enum", keyword: "enum", params: { allowedValues: schema36.oneOf[1].properties.operator.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err31];
        } else {
          vErrors.push(err31);
        }
        errors++;
      }
    }
    if (data.expected !== void 0) {
      if (!validate54(data.expected, { instancePath: instancePath + "/expected", parentData: data, parentDataProperty: "expected", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err32 = { instancePath, schemaPath: "#/oneOf/1/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err32];
    } else {
      vErrors.push(err32);
    }
    errors++;
  }
  var _valid0 = _errs13 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props1 !== true) {
        props1 = true;
      }
    }
    const _errs27 = errors;
    if (data && typeof data == "object" && !Array.isArray(data)) {
      if (data.id === void 0) {
        const err33 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
        if (vErrors === null) {
          vErrors = [err33];
        } else {
          vErrors.push(err33);
        }
        errors++;
      }
      if (data.type === void 0) {
        const err34 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
        if (vErrors === null) {
          vErrors = [err34];
        } else {
          vErrors.push(err34);
        }
        errors++;
      }
      if (data.version === void 0) {
        const err35 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
        if (vErrors === null) {
          vErrors = [err35];
        } else {
          vErrors.push(err35);
        }
        errors++;
      }
      if (data.url === void 0) {
        const err36 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "url" }, message: "must have required property 'url'" };
        if (vErrors === null) {
          vErrors = [err36];
        } else {
          vErrors.push(err36);
        }
        errors++;
      }
      if (data.method === void 0) {
        const err37 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
        if (vErrors === null) {
          vErrors = [err37];
        } else {
          vErrors.push(err37);
        }
        errors++;
      }
      if (data.headers === void 0) {
        const err38 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "headers" }, message: "must have required property 'headers'" };
        if (vErrors === null) {
          vErrors = [err38];
        } else {
          vErrors.push(err38);
        }
        errors++;
      }
      if (data.body === void 0) {
        const err39 = { instancePath, schemaPath: "#/oneOf/2/required", keyword: "required", params: { missingProperty: "body" }, message: "must have required property 'body'" };
        if (vErrors === null) {
          vErrors = [err39];
        } else {
          vErrors.push(err39);
        }
        errors++;
      }
      for (const key2 in data) {
        if (!func4.call(schema36.oneOf[2].properties, key2)) {
          const err40 = { instancePath, schemaPath: "#/oneOf/2/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
      }
      if (data.id !== void 0) {
        let data14 = data.id;
        if (typeof data14 === "string") {
          if (!pattern3.test(data14)) {
            const err41 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/2/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
            if (vErrors === null) {
              vErrors = [err41];
            } else {
              vErrors.push(err41);
            }
            errors++;
          }
        } else {
          const err42 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/2/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
      }
      if (data.type !== void 0) {
        if ("http" !== data.type) {
          const err43 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/2/properties/type/const", keyword: "const", params: { allowedValue: "http" }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        }
      }
      if (data.version !== void 0) {
        if (1 !== data.version) {
          const err44 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/2/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
          if (vErrors === null) {
            vErrors = [err44];
          } else {
            vErrors.push(err44);
          }
          errors++;
        }
      }
      if (data.name !== void 0) {
        let data17 = data.name;
        if (typeof data17 === "string") {
          if (func1(data17) > 1e5) {
            const err45 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/2/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
        } else {
          const err46 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/2/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
          if (vErrors === null) {
            vErrors = [err46];
          } else {
            vErrors.push(err46);
          }
          errors++;
        }
      }
      if (data.timeoutMs !== void 0) {
        let data18 = data.timeoutMs;
        if (!(typeof data18 == "number" && (!(data18 % 1) && !isNaN(data18)))) {
          const err47 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/2/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
          if (vErrors === null) {
            vErrors = [err47];
          } else {
            vErrors.push(err47);
          }
          errors++;
        }
        if (typeof data18 == "number") {
          if (data18 > 36e5 || isNaN(data18)) {
            const err48 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/2/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
            if (vErrors === null) {
              vErrors = [err48];
            } else {
              vErrors.push(err48);
            }
            errors++;
          }
          if (data18 < 100 || isNaN(data18)) {
            const err49 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/2/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
            if (vErrors === null) {
              vErrors = [err49];
            } else {
              vErrors.push(err49);
            }
            errors++;
          }
        }
      }
      if (data.url !== void 0) {
        if (!validate54(data.url, { instancePath: instancePath + "/url", parentData: data, parentDataProperty: "url", rootData, dynamicAnchors })) {
          vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
          errors = vErrors.length;
        }
      }
      if (data.method !== void 0) {
        let data20 = data.method;
        if (!(data20 === "GET" || data20 === "POST" || data20 === "PUT" || data20 === "DELETE")) {
          const err50 = { instancePath: instancePath + "/method", schemaPath: "#/oneOf/2/properties/method/enum", keyword: "enum", params: { allowedValues: schema36.oneOf[2].properties.method.enum }, message: "must be equal to one of the allowed values" };
          if (vErrors === null) {
            vErrors = [err50];
          } else {
            vErrors.push(err50);
          }
          errors++;
        }
      }
      if (data.headers !== void 0) {
        if (!validate54(data.headers, { instancePath: instancePath + "/headers", parentData: data, parentDataProperty: "headers", rootData, dynamicAnchors })) {
          vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
          errors = vErrors.length;
        }
      }
      if (data.body !== void 0) {
        if (!validate54(data.body, { instancePath: instancePath + "/body", parentData: data, parentDataProperty: "body", rootData, dynamicAnchors })) {
          vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
          errors = vErrors.length;
        }
      }
    } else {
      const err51 = { instancePath, schemaPath: "#/oneOf/2/type", keyword: "type", params: { type: "object" }, message: "must be object" };
      if (vErrors === null) {
        vErrors = [err51];
      } else {
        vErrors.push(err51);
      }
      errors++;
    }
    var _valid0 = _errs27 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
        if (props1 !== true) {
          props1 = true;
        }
      }
      const _errs42 = errors;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.id === void 0) {
          const err52 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
          if (vErrors === null) {
            vErrors = [err52];
          } else {
            vErrors.push(err52);
          }
          errors++;
        }
        if (data.type === void 0) {
          const err53 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
        if (data.version === void 0) {
          const err54 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
          if (vErrors === null) {
            vErrors = [err54];
          } else {
            vErrors.push(err54);
          }
          errors++;
        }
        if (data.language === void 0) {
          const err55 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "language" }, message: "must have required property 'language'" };
          if (vErrors === null) {
            vErrors = [err55];
          } else {
            vErrors.push(err55);
          }
          errors++;
        }
        if (data.code === void 0) {
          const err56 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "code" }, message: "must have required property 'code'" };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
        if (data.input === void 0) {
          const err57 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "input" }, message: "must have required property 'input'" };
          if (vErrors === null) {
            vErrors = [err57];
          } else {
            vErrors.push(err57);
          }
          errors++;
        }
        if (data.dependencies === void 0) {
          const err58 = { instancePath, schemaPath: "#/oneOf/3/required", keyword: "required", params: { missingProperty: "dependencies" }, message: "must have required property 'dependencies'" };
          if (vErrors === null) {
            vErrors = [err58];
          } else {
            vErrors.push(err58);
          }
          errors++;
        }
        for (const key3 in data) {
          if (!func4.call(schema36.oneOf[3].properties, key3)) {
            const err59 = { instancePath, schemaPath: "#/oneOf/3/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err59];
            } else {
              vErrors.push(err59);
            }
            errors++;
          }
        }
        if (data.id !== void 0) {
          let data23 = data.id;
          if (typeof data23 === "string") {
            if (!pattern3.test(data23)) {
              const err60 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/3/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
              if (vErrors === null) {
                vErrors = [err60];
              } else {
                vErrors.push(err60);
              }
              errors++;
            }
          } else {
            const err61 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/3/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err61];
            } else {
              vErrors.push(err61);
            }
            errors++;
          }
        }
        if (data.type !== void 0) {
          if ("script" !== data.type) {
            const err62 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/3/properties/type/const", keyword: "const", params: { allowedValue: "script" }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err62];
            } else {
              vErrors.push(err62);
            }
            errors++;
          }
        }
        if (data.version !== void 0) {
          if (1 !== data.version) {
            const err63 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/3/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
        }
        if (data.name !== void 0) {
          let data26 = data.name;
          if (typeof data26 === "string") {
            if (func1(data26) > 1e5) {
              const err64 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/3/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
              if (vErrors === null) {
                vErrors = [err64];
              } else {
                vErrors.push(err64);
              }
              errors++;
            }
          } else {
            const err65 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/3/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err65];
            } else {
              vErrors.push(err65);
            }
            errors++;
          }
        }
        if (data.timeoutMs !== void 0) {
          let data27 = data.timeoutMs;
          if (!(typeof data27 == "number" && (!(data27 % 1) && !isNaN(data27)))) {
            const err66 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/3/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err66];
            } else {
              vErrors.push(err66);
            }
            errors++;
          }
          if (typeof data27 == "number") {
            if (data27 > 36e5 || isNaN(data27)) {
              const err67 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/3/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
              if (vErrors === null) {
                vErrors = [err67];
              } else {
                vErrors.push(err67);
              }
              errors++;
            }
            if (data27 < 100 || isNaN(data27)) {
              const err68 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/3/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
              if (vErrors === null) {
                vErrors = [err68];
              } else {
                vErrors.push(err68);
              }
              errors++;
            }
          }
        }
        if (data.language !== void 0) {
          let data28 = data.language;
          if (!(data28 === "js" || data28 === "ts")) {
            const err69 = { instancePath: instancePath + "/language", schemaPath: "#/oneOf/3/properties/language/enum", keyword: "enum", params: { allowedValues: schema36.oneOf[3].properties.language.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err69];
            } else {
              vErrors.push(err69);
            }
            errors++;
          }
        }
        if (data.code !== void 0) {
          let data29 = data.code;
          if (typeof data29 === "string") {
            if (func1(data29) > 10485760) {
              const err70 = { instancePath: instancePath + "/code", schemaPath: "#/oneOf/3/properties/code/maxLength", keyword: "maxLength", params: { limit: 10485760 }, message: "must NOT have more than 10485760 characters" };
              if (vErrors === null) {
                vErrors = [err70];
              } else {
                vErrors.push(err70);
              }
              errors++;
            }
          } else {
            const err71 = { instancePath: instancePath + "/code", schemaPath: "#/oneOf/3/properties/code/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err71];
            } else {
              vErrors.push(err71);
            }
            errors++;
          }
        }
        if (data.input !== void 0) {
          if (!validate54(data.input, { instancePath: instancePath + "/input", parentData: data, parentDataProperty: "input", rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
            errors = vErrors.length;
          }
        }
        if (data.dependencies !== void 0) {
          let data31 = data.dependencies;
          if (Array.isArray(data31)) {
            if (data31.length > 1e3) {
              const err72 = { instancePath: instancePath + "/dependencies", schemaPath: "#/oneOf/3/properties/dependencies/maxItems", keyword: "maxItems", params: { limit: 1e3 }, message: "must NOT have more than 1000 items" };
              if (vErrors === null) {
                vErrors = [err72];
              } else {
                vErrors.push(err72);
              }
              errors++;
            }
            const len0 = data31.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data32 = data31[i0];
              if (data32 && typeof data32 == "object" && !Array.isArray(data32)) {
                if (data32.name === void 0) {
                  const err73 = { instancePath: instancePath + "/dependencies/" + i0, schemaPath: "#/oneOf/3/properties/dependencies/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
                  if (vErrors === null) {
                    vErrors = [err73];
                  } else {
                    vErrors.push(err73);
                  }
                  errors++;
                }
                if (data32.version === void 0) {
                  const err74 = { instancePath: instancePath + "/dependencies/" + i0, schemaPath: "#/oneOf/3/properties/dependencies/items/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                  if (vErrors === null) {
                    vErrors = [err74];
                  } else {
                    vErrors.push(err74);
                  }
                  errors++;
                }
                for (const key4 in data32) {
                  if (!(key4 === "name" || key4 === "version")) {
                    const err75 = { instancePath: instancePath + "/dependencies/" + i0, schemaPath: "#/oneOf/3/properties/dependencies/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err75];
                    } else {
                      vErrors.push(err75);
                    }
                    errors++;
                  }
                }
                if (data32.name !== void 0) {
                  let data33 = data32.name;
                  if (typeof data33 === "string") {
                    if (func1(data33) > 1e5) {
                      const err76 = { instancePath: instancePath + "/dependencies/" + i0 + "/name", schemaPath: "#/oneOf/3/properties/dependencies/items/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                      if (vErrors === null) {
                        vErrors = [err76];
                      } else {
                        vErrors.push(err76);
                      }
                      errors++;
                    }
                  } else {
                    const err77 = { instancePath: instancePath + "/dependencies/" + i0 + "/name", schemaPath: "#/oneOf/3/properties/dependencies/items/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err77];
                    } else {
                      vErrors.push(err77);
                    }
                    errors++;
                  }
                }
                if (data32.version !== void 0) {
                  let data34 = data32.version;
                  if (typeof data34 === "string") {
                    if (func1(data34) > 1e5) {
                      const err78 = { instancePath: instancePath + "/dependencies/" + i0 + "/version", schemaPath: "#/oneOf/3/properties/dependencies/items/properties/version/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                      if (vErrors === null) {
                        vErrors = [err78];
                      } else {
                        vErrors.push(err78);
                      }
                      errors++;
                    }
                  } else {
                    const err79 = { instancePath: instancePath + "/dependencies/" + i0 + "/version", schemaPath: "#/oneOf/3/properties/dependencies/items/properties/version/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err79];
                    } else {
                      vErrors.push(err79);
                    }
                    errors++;
                  }
                }
              } else {
                const err80 = { instancePath: instancePath + "/dependencies/" + i0, schemaPath: "#/oneOf/3/properties/dependencies/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err80];
                } else {
                  vErrors.push(err80);
                }
                errors++;
              }
            }
          } else {
            const err81 = { instancePath: instancePath + "/dependencies", schemaPath: "#/oneOf/3/properties/dependencies/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err81];
            } else {
              vErrors.push(err81);
            }
            errors++;
          }
        }
      } else {
        const err82 = { instancePath, schemaPath: "#/oneOf/3/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err82];
        } else {
          vErrors.push(err82);
        }
        errors++;
      }
      var _valid0 = _errs42 === errors;
      if (_valid0 && valid0) {
        valid0 = false;
        passing0 = [passing0, 3];
      } else {
        if (_valid0) {
          valid0 = true;
          passing0 = 3;
          if (props1 !== true) {
            props1 = true;
          }
        }
        const _errs66 = errors;
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.id === void 0) {
            const err83 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
            if (vErrors === null) {
              vErrors = [err83];
            } else {
              vErrors.push(err83);
            }
            errors++;
          }
          if (data.type === void 0) {
            const err84 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
            if (vErrors === null) {
              vErrors = [err84];
            } else {
              vErrors.push(err84);
            }
            errors++;
          }
          if (data.version === void 0) {
            const err85 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
            if (vErrors === null) {
              vErrors = [err85];
            } else {
              vErrors.push(err85);
            }
            errors++;
          }
          if (data.operation === void 0) {
            const err86 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
            if (vErrors === null) {
              vErrors = [err86];
            } else {
              vErrors.push(err86);
            }
            errors++;
          }
          if (data.binding === void 0) {
            const err87 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
            if (vErrors === null) {
              vErrors = [err87];
            } else {
              vErrors.push(err87);
            }
            errors++;
          }
          if (data.name === void 0) {
            const err88 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
            if (vErrors === null) {
              vErrors = [err88];
            } else {
              vErrors.push(err88);
            }
            errors++;
          }
          if (data.content === void 0) {
            const err89 = { instancePath, schemaPath: "#/oneOf/4/required", keyword: "required", params: { missingProperty: "content" }, message: "must have required property 'content'" };
            if (vErrors === null) {
              vErrors = [err89];
            } else {
              vErrors.push(err89);
            }
            errors++;
          }
          for (const key5 in data) {
            if (!(key5 === "id" || key5 === "type" || key5 === "version" || key5 === "name" || key5 === "timeoutMs" || key5 === "operation" || key5 === "binding" || key5 === "content")) {
              const err90 = { instancePath, schemaPath: "#/oneOf/4/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
              if (vErrors === null) {
                vErrors = [err90];
              } else {
                vErrors.push(err90);
              }
              errors++;
            }
          }
          if (data.id !== void 0) {
            let data35 = data.id;
            if (typeof data35 === "string") {
              if (!pattern3.test(data35)) {
                const err91 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/4/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                if (vErrors === null) {
                  vErrors = [err91];
                } else {
                  vErrors.push(err91);
                }
                errors++;
              }
            } else {
              const err92 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/4/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err92];
              } else {
                vErrors.push(err92);
              }
              errors++;
            }
          }
          if (data.type !== void 0) {
            if ("file" !== data.type) {
              const err93 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/4/properties/type/const", keyword: "const", params: { allowedValue: "file" }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err93];
              } else {
                vErrors.push(err93);
              }
              errors++;
            }
          }
          if (data.version !== void 0) {
            if (1 !== data.version) {
              const err94 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/4/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
              if (vErrors === null) {
                vErrors = [err94];
              } else {
                vErrors.push(err94);
              }
              errors++;
            }
          }
          if (data.name !== void 0) {
            if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
              vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
              errors = vErrors.length;
            }
          }
          if (data.timeoutMs !== void 0) {
            let data39 = data.timeoutMs;
            if (!(typeof data39 == "number" && (!(data39 % 1) && !isNaN(data39)))) {
              const err95 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/4/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
              if (vErrors === null) {
                vErrors = [err95];
              } else {
                vErrors.push(err95);
              }
              errors++;
            }
            if (typeof data39 == "number") {
              if (data39 > 36e5 || isNaN(data39)) {
                const err96 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/4/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                if (vErrors === null) {
                  vErrors = [err96];
                } else {
                  vErrors.push(err96);
                }
                errors++;
              }
              if (data39 < 100 || isNaN(data39)) {
                const err97 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/4/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                if (vErrors === null) {
                  vErrors = [err97];
                } else {
                  vErrors.push(err97);
                }
                errors++;
              }
            }
          }
          if (data.operation !== void 0) {
            let data40 = data.operation;
            if (!(data40 === "read" || data40 === "write" || data40 === "copy")) {
              const err98 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/4/properties/operation/enum", keyword: "enum", params: { allowedValues: schema36.oneOf[4].properties.operation.enum }, message: "must be equal to one of the allowed values" };
              if (vErrors === null) {
                vErrors = [err98];
              } else {
                vErrors.push(err98);
              }
              errors++;
            }
          }
          if (data.binding !== void 0) {
            let data41 = data.binding;
            if (typeof data41 === "string") {
              if (func1(data41) > 1e5) {
                const err99 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/4/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                if (vErrors === null) {
                  vErrors = [err99];
                } else {
                  vErrors.push(err99);
                }
                errors++;
              }
            } else {
              const err100 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/4/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              if (vErrors === null) {
                vErrors = [err100];
              } else {
                vErrors.push(err100);
              }
              errors++;
            }
          }
          if (data.content !== void 0) {
            if (!validate54(data.content, { instancePath: instancePath + "/content", parentData: data, parentDataProperty: "content", rootData, dynamicAnchors })) {
              vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
              errors = vErrors.length;
            }
          }
        } else {
          const err101 = { instancePath, schemaPath: "#/oneOf/4/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          if (vErrors === null) {
            vErrors = [err101];
          } else {
            vErrors.push(err101);
          }
          errors++;
        }
        var _valid0 = _errs66 === errors;
        if (_valid0 && valid0) {
          valid0 = false;
          passing0 = [passing0, 4];
        } else {
          if (_valid0) {
            valid0 = true;
            passing0 = 4;
            if (props1 !== true) {
              props1 = true;
            }
          }
          const _errs80 = errors;
          if (data && typeof data == "object" && !Array.isArray(data)) {
            if (data.id === void 0) {
              const err102 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
              if (vErrors === null) {
                vErrors = [err102];
              } else {
                vErrors.push(err102);
              }
              errors++;
            }
            if (data.type === void 0) {
              const err103 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
              if (vErrors === null) {
                vErrors = [err103];
              } else {
                vErrors.push(err103);
              }
              errors++;
            }
            if (data.version === void 0) {
              const err104 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
              if (vErrors === null) {
                vErrors = [err104];
              } else {
                vErrors.push(err104);
              }
              errors++;
            }
            if (data.operation === void 0) {
              const err105 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
              if (vErrors === null) {
                vErrors = [err105];
              } else {
                vErrors.push(err105);
              }
              errors++;
            }
            if (data.binding === void 0) {
              const err106 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
              if (vErrors === null) {
                vErrors = [err106];
              } else {
                vErrors.push(err106);
              }
              errors++;
            }
            if (data.name === void 0) {
              const err107 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              if (vErrors === null) {
                vErrors = [err107];
              } else {
                vErrors.push(err107);
              }
              errors++;
            }
            if (data.rows === void 0) {
              const err108 = { instancePath, schemaPath: "#/oneOf/5/required", keyword: "required", params: { missingProperty: "rows" }, message: "must have required property 'rows'" };
              if (vErrors === null) {
                vErrors = [err108];
              } else {
                vErrors.push(err108);
              }
              errors++;
            }
            for (const key6 in data) {
              if (!(key6 === "id" || key6 === "type" || key6 === "version" || key6 === "name" || key6 === "timeoutMs" || key6 === "operation" || key6 === "binding" || key6 === "rows")) {
                const err109 = { instancePath, schemaPath: "#/oneOf/5/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
                if (vErrors === null) {
                  vErrors = [err109];
                } else {
                  vErrors.push(err109);
                }
                errors++;
              }
            }
            if (data.id !== void 0) {
              let data43 = data.id;
              if (typeof data43 === "string") {
                if (!pattern3.test(data43)) {
                  const err110 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/5/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                  if (vErrors === null) {
                    vErrors = [err110];
                  } else {
                    vErrors.push(err110);
                  }
                  errors++;
                }
              } else {
                const err111 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/5/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err111];
                } else {
                  vErrors.push(err111);
                }
                errors++;
              }
            }
            if (data.type !== void 0) {
              if ("excel" !== data.type) {
                const err112 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/5/properties/type/const", keyword: "const", params: { allowedValue: "excel" }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err112];
                } else {
                  vErrors.push(err112);
                }
                errors++;
              }
            }
            if (data.version !== void 0) {
              if (1 !== data.version) {
                const err113 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/5/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
                if (vErrors === null) {
                  vErrors = [err113];
                } else {
                  vErrors.push(err113);
                }
                errors++;
              }
            }
            if (data.name !== void 0) {
              if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
                vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                errors = vErrors.length;
              }
            }
            if (data.timeoutMs !== void 0) {
              let data47 = data.timeoutMs;
              if (!(typeof data47 == "number" && (!(data47 % 1) && !isNaN(data47)))) {
                const err114 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/5/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                if (vErrors === null) {
                  vErrors = [err114];
                } else {
                  vErrors.push(err114);
                }
                errors++;
              }
              if (typeof data47 == "number") {
                if (data47 > 36e5 || isNaN(data47)) {
                  const err115 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/5/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                  if (vErrors === null) {
                    vErrors = [err115];
                  } else {
                    vErrors.push(err115);
                  }
                  errors++;
                }
                if (data47 < 100 || isNaN(data47)) {
                  const err116 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/5/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                  if (vErrors === null) {
                    vErrors = [err116];
                  } else {
                    vErrors.push(err116);
                  }
                  errors++;
                }
              }
            }
            if (data.operation !== void 0) {
              let data48 = data.operation;
              if (!(data48 === "read" || data48 === "write")) {
                const err117 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/5/properties/operation/enum", keyword: "enum", params: { allowedValues: schema36.oneOf[5].properties.operation.enum }, message: "must be equal to one of the allowed values" };
                if (vErrors === null) {
                  vErrors = [err117];
                } else {
                  vErrors.push(err117);
                }
                errors++;
              }
            }
            if (data.binding !== void 0) {
              let data49 = data.binding;
              if (typeof data49 === "string") {
                if (func1(data49) > 1e5) {
                  const err118 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/5/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                  if (vErrors === null) {
                    vErrors = [err118];
                  } else {
                    vErrors.push(err118);
                  }
                  errors++;
                }
              } else {
                const err119 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/5/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err119];
                } else {
                  vErrors.push(err119);
                }
                errors++;
              }
            }
            if (data.rows !== void 0) {
              if (!validate54(data.rows, { instancePath: instancePath + "/rows", parentData: data, parentDataProperty: "rows", rootData, dynamicAnchors })) {
                vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                errors = vErrors.length;
              }
            }
          } else {
            const err120 = { instancePath, schemaPath: "#/oneOf/5/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err120];
            } else {
              vErrors.push(err120);
            }
            errors++;
          }
          var _valid0 = _errs80 === errors;
          if (_valid0 && valid0) {
            valid0 = false;
            passing0 = [passing0, 5];
          } else {
            if (_valid0) {
              valid0 = true;
              passing0 = 5;
              if (props1 !== true) {
                props1 = true;
              }
            }
            const _errs94 = errors;
            if (data && typeof data == "object" && !Array.isArray(data)) {
              if (data.id === void 0) {
                const err121 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                if (vErrors === null) {
                  vErrors = [err121];
                } else {
                  vErrors.push(err121);
                }
                errors++;
              }
              if (data.type === void 0) {
                const err122 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                if (vErrors === null) {
                  vErrors = [err122];
                } else {
                  vErrors.push(err122);
                }
                errors++;
              }
              if (data.version === void 0) {
                const err123 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                if (vErrors === null) {
                  vErrors = [err123];
                } else {
                  vErrors.push(err123);
                }
                errors++;
              }
              if (data.operation === void 0) {
                const err124 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
                if (vErrors === null) {
                  vErrors = [err124];
                } else {
                  vErrors.push(err124);
                }
                errors++;
              }
              if (data.binding === void 0) {
                const err125 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
                if (vErrors === null) {
                  vErrors = [err125];
                } else {
                  vErrors.push(err125);
                }
                errors++;
              }
              if (data.name === void 0) {
                const err126 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
                if (vErrors === null) {
                  vErrors = [err126];
                } else {
                  vErrors.push(err126);
                }
                errors++;
              }
              if (data.templateName === void 0) {
                const err127 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "templateName" }, message: "must have required property 'templateName'" };
                if (vErrors === null) {
                  vErrors = [err127];
                } else {
                  vErrors.push(err127);
                }
                errors++;
              }
              if (data.sheet === void 0) {
                const err128 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "sheet" }, message: "must have required property 'sheet'" };
                if (vErrors === null) {
                  vErrors = [err128];
                } else {
                  vErrors.push(err128);
                }
                errors++;
              }
              if (data.cells === void 0) {
                const err129 = { instancePath, schemaPath: "#/oneOf/6/required", keyword: "required", params: { missingProperty: "cells" }, message: "must have required property 'cells'" };
                if (vErrors === null) {
                  vErrors = [err129];
                } else {
                  vErrors.push(err129);
                }
                errors++;
              }
              for (const key7 in data) {
                if (!func4.call(schema36.oneOf[6].properties, key7)) {
                  const err130 = { instancePath, schemaPath: "#/oneOf/6/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key7 }, message: "must NOT have additional properties" };
                  if (vErrors === null) {
                    vErrors = [err130];
                  } else {
                    vErrors.push(err130);
                  }
                  errors++;
                }
              }
              if (data.id !== void 0) {
                let data51 = data.id;
                if (typeof data51 === "string") {
                  if (!pattern3.test(data51)) {
                    const err131 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/6/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                    if (vErrors === null) {
                      vErrors = [err131];
                    } else {
                      vErrors.push(err131);
                    }
                    errors++;
                  }
                } else {
                  const err132 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/6/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err132];
                  } else {
                    vErrors.push(err132);
                  }
                  errors++;
                }
              }
              if (data.type !== void 0) {
                if ("excel" !== data.type) {
                  const err133 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/6/properties/type/const", keyword: "const", params: { allowedValue: "excel" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err133];
                  } else {
                    vErrors.push(err133);
                  }
                  errors++;
                }
              }
              if (data.version !== void 0) {
                if (2 !== data.version) {
                  const err134 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/6/properties/version/const", keyword: "const", params: { allowedValue: 2 }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err134];
                  } else {
                    vErrors.push(err134);
                  }
                  errors++;
                }
              }
              if (data.name !== void 0) {
                if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
                  vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                  errors = vErrors.length;
                }
              }
              if (data.timeoutMs !== void 0) {
                let data55 = data.timeoutMs;
                if (!(typeof data55 == "number" && (!(data55 % 1) && !isNaN(data55)))) {
                  const err135 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/6/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                  if (vErrors === null) {
                    vErrors = [err135];
                  } else {
                    vErrors.push(err135);
                  }
                  errors++;
                }
                if (typeof data55 == "number") {
                  if (data55 > 36e5 || isNaN(data55)) {
                    const err136 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/6/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                    if (vErrors === null) {
                      vErrors = [err136];
                    } else {
                      vErrors.push(err136);
                    }
                    errors++;
                  }
                  if (data55 < 100 || isNaN(data55)) {
                    const err137 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/6/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                    if (vErrors === null) {
                      vErrors = [err137];
                    } else {
                      vErrors.push(err137);
                    }
                    errors++;
                  }
                }
              }
              if (data.operation !== void 0) {
                if ("fill" !== data.operation) {
                  const err138 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/6/properties/operation/const", keyword: "const", params: { allowedValue: "fill" }, message: "must be equal to constant" };
                  if (vErrors === null) {
                    vErrors = [err138];
                  } else {
                    vErrors.push(err138);
                  }
                  errors++;
                }
              }
              if (data.binding !== void 0) {
                let data57 = data.binding;
                if (typeof data57 === "string") {
                  if (func1(data57) > 1e5) {
                    const err139 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/6/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                    if (vErrors === null) {
                      vErrors = [err139];
                    } else {
                      vErrors.push(err139);
                    }
                    errors++;
                  }
                } else {
                  const err140 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/6/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err140];
                  } else {
                    vErrors.push(err140);
                  }
                  errors++;
                }
              }
              if (data.templateName !== void 0) {
                if (!validate54(data.templateName, { instancePath: instancePath + "/templateName", parentData: data, parentDataProperty: "templateName", rootData, dynamicAnchors })) {
                  vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                  errors = vErrors.length;
                }
              }
              if (data.sheet !== void 0) {
                let data59 = data.sheet;
                if (typeof data59 === "string") {
                  if (func1(data59) > 1e5) {
                    const err141 = { instancePath: instancePath + "/sheet", schemaPath: "#/oneOf/6/properties/sheet/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                    if (vErrors === null) {
                      vErrors = [err141];
                    } else {
                      vErrors.push(err141);
                    }
                    errors++;
                  }
                } else {
                  const err142 = { instancePath: instancePath + "/sheet", schemaPath: "#/oneOf/6/properties/sheet/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                  if (vErrors === null) {
                    vErrors = [err142];
                  } else {
                    vErrors.push(err142);
                  }
                  errors++;
                }
              }
              if (data.cells !== void 0) {
                if (!validate54(data.cells, { instancePath: instancePath + "/cells", parentData: data, parentDataProperty: "cells", rootData, dynamicAnchors })) {
                  vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                  errors = vErrors.length;
                }
              }
            } else {
              const err143 = { instancePath, schemaPath: "#/oneOf/6/type", keyword: "type", params: { type: "object" }, message: "must be object" };
              if (vErrors === null) {
                vErrors = [err143];
              } else {
                vErrors.push(err143);
              }
              errors++;
            }
            var _valid0 = _errs94 === errors;
            if (_valid0 && valid0) {
              valid0 = false;
              passing0 = [passing0, 6];
            } else {
              if (_valid0) {
                valid0 = true;
                passing0 = 6;
                if (props1 !== true) {
                  props1 = true;
                }
              }
              const _errs111 = errors;
              if (data && typeof data == "object" && !Array.isArray(data)) {
                if (data.id === void 0) {
                  const err144 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                  if (vErrors === null) {
                    vErrors = [err144];
                  } else {
                    vErrors.push(err144);
                  }
                  errors++;
                }
                if (data.type === void 0) {
                  const err145 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                  if (vErrors === null) {
                    vErrors = [err145];
                  } else {
                    vErrors.push(err145);
                  }
                  errors++;
                }
                if (data.version === void 0) {
                  const err146 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                  if (vErrors === null) {
                    vErrors = [err146];
                  } else {
                    vErrors.push(err146);
                  }
                  errors++;
                }
                if (data.operation === void 0) {
                  const err147 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
                  if (vErrors === null) {
                    vErrors = [err147];
                  } else {
                    vErrors.push(err147);
                  }
                  errors++;
                }
                if (data.binding === void 0) {
                  const err148 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
                  if (vErrors === null) {
                    vErrors = [err148];
                  } else {
                    vErrors.push(err148);
                  }
                  errors++;
                }
                if (data.name === void 0) {
                  const err149 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
                  if (vErrors === null) {
                    vErrors = [err149];
                  } else {
                    vErrors.push(err149);
                  }
                  errors++;
                }
                if (data.files === void 0) {
                  const err150 = { instancePath, schemaPath: "#/oneOf/7/required", keyword: "required", params: { missingProperty: "files" }, message: "must have required property 'files'" };
                  if (vErrors === null) {
                    vErrors = [err150];
                  } else {
                    vErrors.push(err150);
                  }
                  errors++;
                }
                for (const key8 in data) {
                  if (!(key8 === "id" || key8 === "type" || key8 === "version" || key8 === "name" || key8 === "timeoutMs" || key8 === "operation" || key8 === "binding" || key8 === "files")) {
                    const err151 = { instancePath, schemaPath: "#/oneOf/7/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key8 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err151];
                    } else {
                      vErrors.push(err151);
                    }
                    errors++;
                  }
                }
                if (data.id !== void 0) {
                  let data61 = data.id;
                  if (typeof data61 === "string") {
                    if (!pattern3.test(data61)) {
                      const err152 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/7/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                      if (vErrors === null) {
                        vErrors = [err152];
                      } else {
                        vErrors.push(err152);
                      }
                      errors++;
                    }
                  } else {
                    const err153 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/7/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err153];
                    } else {
                      vErrors.push(err153);
                    }
                    errors++;
                  }
                }
                if (data.type !== void 0) {
                  if ("file" !== data.type) {
                    const err154 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/7/properties/type/const", keyword: "const", params: { allowedValue: "file" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err154];
                    } else {
                      vErrors.push(err154);
                    }
                    errors++;
                  }
                }
                if (data.version !== void 0) {
                  if (2 !== data.version) {
                    const err155 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/7/properties/version/const", keyword: "const", params: { allowedValue: 2 }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err155];
                    } else {
                      vErrors.push(err155);
                    }
                    errors++;
                  }
                }
                if (data.name !== void 0) {
                  if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
                    vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                    errors = vErrors.length;
                  }
                }
                if (data.timeoutMs !== void 0) {
                  let data65 = data.timeoutMs;
                  if (!(typeof data65 == "number" && (!(data65 % 1) && !isNaN(data65)))) {
                    const err156 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/7/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err156];
                    } else {
                      vErrors.push(err156);
                    }
                    errors++;
                  }
                  if (typeof data65 == "number") {
                    if (data65 > 36e5 || isNaN(data65)) {
                      const err157 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/7/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                      if (vErrors === null) {
                        vErrors = [err157];
                      } else {
                        vErrors.push(err157);
                      }
                      errors++;
                    }
                    if (data65 < 100 || isNaN(data65)) {
                      const err158 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/7/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                      if (vErrors === null) {
                        vErrors = [err158];
                      } else {
                        vErrors.push(err158);
                      }
                      errors++;
                    }
                  }
                }
                if (data.operation !== void 0) {
                  if ("archive" !== data.operation) {
                    const err159 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/7/properties/operation/const", keyword: "const", params: { allowedValue: "archive" }, message: "must be equal to constant" };
                    if (vErrors === null) {
                      vErrors = [err159];
                    } else {
                      vErrors.push(err159);
                    }
                    errors++;
                  }
                }
                if (data.binding !== void 0) {
                  let data67 = data.binding;
                  if (typeof data67 === "string") {
                    if (func1(data67) > 1e5) {
                      const err160 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/7/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                      if (vErrors === null) {
                        vErrors = [err160];
                      } else {
                        vErrors.push(err160);
                      }
                      errors++;
                    }
                  } else {
                    const err161 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/7/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err161];
                    } else {
                      vErrors.push(err161);
                    }
                    errors++;
                  }
                }
                if (data.files !== void 0) {
                  if (!validate54(data.files, { instancePath: instancePath + "/files", parentData: data, parentDataProperty: "files", rootData, dynamicAnchors })) {
                    vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                    errors = vErrors.length;
                  }
                }
              } else {
                const err162 = { instancePath, schemaPath: "#/oneOf/7/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err162];
                } else {
                  vErrors.push(err162);
                }
                errors++;
              }
              var _valid0 = _errs111 === errors;
              if (_valid0 && valid0) {
                valid0 = false;
                passing0 = [passing0, 7];
              } else {
                if (_valid0) {
                  valid0 = true;
                  passing0 = 7;
                  if (props1 !== true) {
                    props1 = true;
                  }
                }
                const _errs125 = errors;
                if (data && typeof data == "object" && !Array.isArray(data)) {
                  if (data.id === void 0) {
                    const err163 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                    if (vErrors === null) {
                      vErrors = [err163];
                    } else {
                      vErrors.push(err163);
                    }
                    errors++;
                  }
                  if (data.type === void 0) {
                    const err164 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                    if (vErrors === null) {
                      vErrors = [err164];
                    } else {
                      vErrors.push(err164);
                    }
                    errors++;
                  }
                  if (data.version === void 0) {
                    const err165 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                    if (vErrors === null) {
                      vErrors = [err165];
                    } else {
                      vErrors.push(err165);
                    }
                    errors++;
                  }
                  if (data.operation === void 0) {
                    const err166 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
                    if (vErrors === null) {
                      vErrors = [err166];
                    } else {
                      vErrors.push(err166);
                    }
                    errors++;
                  }
                  if (data.selector === void 0) {
                    const err167 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "selector" }, message: "must have required property 'selector'" };
                    if (vErrors === null) {
                      vErrors = [err167];
                    } else {
                      vErrors.push(err167);
                    }
                    errors++;
                  }
                  if (data.value === void 0) {
                    const err168 = { instancePath, schemaPath: "#/oneOf/8/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                    if (vErrors === null) {
                      vErrors = [err168];
                    } else {
                      vErrors.push(err168);
                    }
                    errors++;
                  }
                  for (const key9 in data) {
                    if (!(key9 === "id" || key9 === "type" || key9 === "version" || key9 === "name" || key9 === "timeoutMs" || key9 === "operation" || key9 === "selector" || key9 === "value")) {
                      const err169 = { instancePath, schemaPath: "#/oneOf/8/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key9 }, message: "must NOT have additional properties" };
                      if (vErrors === null) {
                        vErrors = [err169];
                      } else {
                        vErrors.push(err169);
                      }
                      errors++;
                    }
                  }
                  if (data.id !== void 0) {
                    let data69 = data.id;
                    if (typeof data69 === "string") {
                      if (!pattern3.test(data69)) {
                        const err170 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/8/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                        if (vErrors === null) {
                          vErrors = [err170];
                        } else {
                          vErrors.push(err170);
                        }
                        errors++;
                      }
                    } else {
                      const err171 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/8/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                      if (vErrors === null) {
                        vErrors = [err171];
                      } else {
                        vErrors.push(err171);
                      }
                      errors++;
                    }
                  }
                  if (data.type !== void 0) {
                    if ("browser" !== data.type) {
                      const err172 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/8/properties/type/const", keyword: "const", params: { allowedValue: "browser" }, message: "must be equal to constant" };
                      if (vErrors === null) {
                        vErrors = [err172];
                      } else {
                        vErrors.push(err172);
                      }
                      errors++;
                    }
                  }
                  if (data.version !== void 0) {
                    if (1 !== data.version) {
                      const err173 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/8/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
                      if (vErrors === null) {
                        vErrors = [err173];
                      } else {
                        vErrors.push(err173);
                      }
                      errors++;
                    }
                  }
                  if (data.name !== void 0) {
                    let data72 = data.name;
                    if (typeof data72 === "string") {
                      if (func1(data72) > 1e5) {
                        const err174 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/8/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                        if (vErrors === null) {
                          vErrors = [err174];
                        } else {
                          vErrors.push(err174);
                        }
                        errors++;
                      }
                    } else {
                      const err175 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/8/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                      if (vErrors === null) {
                        vErrors = [err175];
                      } else {
                        vErrors.push(err175);
                      }
                      errors++;
                    }
                  }
                  if (data.timeoutMs !== void 0) {
                    let data73 = data.timeoutMs;
                    if (!(typeof data73 == "number" && (!(data73 % 1) && !isNaN(data73)))) {
                      const err176 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/8/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                      if (vErrors === null) {
                        vErrors = [err176];
                      } else {
                        vErrors.push(err176);
                      }
                      errors++;
                    }
                    if (typeof data73 == "number") {
                      if (data73 > 36e5 || isNaN(data73)) {
                        const err177 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/8/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                        if (vErrors === null) {
                          vErrors = [err177];
                        } else {
                          vErrors.push(err177);
                        }
                        errors++;
                      }
                      if (data73 < 100 || isNaN(data73)) {
                        const err178 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/8/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                        if (vErrors === null) {
                          vErrors = [err178];
                        } else {
                          vErrors.push(err178);
                        }
                        errors++;
                      }
                    }
                  }
                  if (data.operation !== void 0) {
                    let data74 = data.operation;
                    if (!(data74 === "navigate" || data74 === "read" || data74 === "click" || data74 === "fill" || data74 === "wait" || data74 === "upload" || data74 === "screenshot" || data74 === "download")) {
                      const err179 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/8/properties/operation/enum", keyword: "enum", params: { allowedValues: schema36.oneOf[8].properties.operation.enum }, message: "must be equal to one of the allowed values" };
                      if (vErrors === null) {
                        vErrors = [err179];
                      } else {
                        vErrors.push(err179);
                      }
                      errors++;
                    }
                  }
                  if (data.selector !== void 0) {
                    let data75 = data.selector;
                    if (typeof data75 === "string") {
                      if (func1(data75) > 1e5) {
                        const err180 = { instancePath: instancePath + "/selector", schemaPath: "#/oneOf/8/properties/selector/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                        if (vErrors === null) {
                          vErrors = [err180];
                        } else {
                          vErrors.push(err180);
                        }
                        errors++;
                      }
                    } else {
                      const err181 = { instancePath: instancePath + "/selector", schemaPath: "#/oneOf/8/properties/selector/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                      if (vErrors === null) {
                        vErrors = [err181];
                      } else {
                        vErrors.push(err181);
                      }
                      errors++;
                    }
                  }
                  if (data.value !== void 0) {
                    if (!validate54(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData, dynamicAnchors })) {
                      vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                      errors = vErrors.length;
                    }
                  }
                } else {
                  const err182 = { instancePath, schemaPath: "#/oneOf/8/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                  if (vErrors === null) {
                    vErrors = [err182];
                  } else {
                    vErrors.push(err182);
                  }
                  errors++;
                }
                var _valid0 = _errs125 === errors;
                if (_valid0 && valid0) {
                  valid0 = false;
                  passing0 = [passing0, 8];
                } else {
                  if (_valid0) {
                    valid0 = true;
                    passing0 = 8;
                    if (props1 !== true) {
                      props1 = true;
                    }
                  }
                  const _errs140 = errors;
                  const _errs143 = errors;
                  let valid14 = true;
                  const _errs144 = errors;
                  if (data && typeof data == "object" && !Array.isArray(data)) {
                    if (data.operation !== void 0) {
                      let data77 = data.operation;
                      if (!(data77 === "navigate" || data77 === "screenshot")) {
                        const err183 = {};
                        if (vErrors === null) {
                          vErrors = [err183];
                        } else {
                          vErrors.push(err183);
                        }
                        errors++;
                      }
                    }
                  }
                  var _valid1 = _errs144 === errors;
                  errors = _errs143;
                  if (vErrors !== null) {
                    if (_errs143) {
                      vErrors.length = _errs143;
                    } else {
                      vErrors = null;
                    }
                  }
                  if (_valid1) {
                    const _errs146 = errors;
                    if (data && typeof data == "object" && !Array.isArray(data)) {
                      if (data.framePath !== void 0) {
                        let data78 = data.framePath;
                        if (Array.isArray(data78)) {
                          if (data78.length > 0) {
                            const err184 = { instancePath: instancePath + "/framePath", schemaPath: "#/oneOf/9/allOf/0/then/properties/framePath/maxItems", keyword: "maxItems", params: { limit: 0 }, message: "must NOT have more than 0 items" };
                            if (vErrors === null) {
                              vErrors = [err184];
                            } else {
                              vErrors.push(err184);
                            }
                            errors++;
                          }
                        }
                      }
                    }
                    var _valid1 = _errs146 === errors;
                    valid14 = _valid1;
                    if (valid14) {
                      var props18 = {};
                      props18.framePath = true;
                      props18.operation = true;
                    }
                  }
                  if (!valid14) {
                    const err185 = { instancePath, schemaPath: "#/oneOf/9/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
                    if (vErrors === null) {
                      vErrors = [err185];
                    } else {
                      vErrors.push(err185);
                    }
                    errors++;
                  }
                  if (data && typeof data == "object" && !Array.isArray(data)) {
                    if (data.id === void 0) {
                      const err186 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                      if (vErrors === null) {
                        vErrors = [err186];
                      } else {
                        vErrors.push(err186);
                      }
                      errors++;
                    }
                    if (data.type === void 0) {
                      const err187 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                      if (vErrors === null) {
                        vErrors = [err187];
                      } else {
                        vErrors.push(err187);
                      }
                      errors++;
                    }
                    if (data.version === void 0) {
                      const err188 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                      if (vErrors === null) {
                        vErrors = [err188];
                      } else {
                        vErrors.push(err188);
                      }
                      errors++;
                    }
                    if (data.operation === void 0) {
                      const err189 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
                      if (vErrors === null) {
                        vErrors = [err189];
                      } else {
                        vErrors.push(err189);
                      }
                      errors++;
                    }
                    if (data.selector === void 0) {
                      const err190 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "selector" }, message: "must have required property 'selector'" };
                      if (vErrors === null) {
                        vErrors = [err190];
                      } else {
                        vErrors.push(err190);
                      }
                      errors++;
                    }
                    if (data.value === void 0) {
                      const err191 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                      if (vErrors === null) {
                        vErrors = [err191];
                      } else {
                        vErrors.push(err191);
                      }
                      errors++;
                    }
                    if (data.framePath === void 0) {
                      const err192 = { instancePath, schemaPath: "#/oneOf/9/required", keyword: "required", params: { missingProperty: "framePath" }, message: "must have required property 'framePath'" };
                      if (vErrors === null) {
                        vErrors = [err192];
                      } else {
                        vErrors.push(err192);
                      }
                      errors++;
                    }
                    for (const key10 in data) {
                      if (!func4.call(schema36.oneOf[9].properties, key10)) {
                        const err193 = { instancePath, schemaPath: "#/oneOf/9/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key10 }, message: "must NOT have additional properties" };
                        if (vErrors === null) {
                          vErrors = [err193];
                        } else {
                          vErrors.push(err193);
                        }
                        errors++;
                      }
                    }
                    if (data.id !== void 0) {
                      let data79 = data.id;
                      if (typeof data79 === "string") {
                        if (!pattern3.test(data79)) {
                          const err194 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/9/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                          if (vErrors === null) {
                            vErrors = [err194];
                          } else {
                            vErrors.push(err194);
                          }
                          errors++;
                        }
                      } else {
                        const err195 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/9/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        if (vErrors === null) {
                          vErrors = [err195];
                        } else {
                          vErrors.push(err195);
                        }
                        errors++;
                      }
                    }
                    if (data.type !== void 0) {
                      if ("browser" !== data.type) {
                        const err196 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/9/properties/type/const", keyword: "const", params: { allowedValue: "browser" }, message: "must be equal to constant" };
                        if (vErrors === null) {
                          vErrors = [err196];
                        } else {
                          vErrors.push(err196);
                        }
                        errors++;
                      }
                    }
                    if (data.version !== void 0) {
                      if (2 !== data.version) {
                        const err197 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/9/properties/version/const", keyword: "const", params: { allowedValue: 2 }, message: "must be equal to constant" };
                        if (vErrors === null) {
                          vErrors = [err197];
                        } else {
                          vErrors.push(err197);
                        }
                        errors++;
                      }
                    }
                    if (data.name !== void 0) {
                      let data82 = data.name;
                      if (typeof data82 === "string") {
                        if (func1(data82) > 1e5) {
                          const err198 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/9/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                          if (vErrors === null) {
                            vErrors = [err198];
                          } else {
                            vErrors.push(err198);
                          }
                          errors++;
                        }
                      } else {
                        const err199 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/9/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        if (vErrors === null) {
                          vErrors = [err199];
                        } else {
                          vErrors.push(err199);
                        }
                        errors++;
                      }
                    }
                    if (data.timeoutMs !== void 0) {
                      let data83 = data.timeoutMs;
                      if (!(typeof data83 == "number" && (!(data83 % 1) && !isNaN(data83)))) {
                        const err200 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/9/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                        if (vErrors === null) {
                          vErrors = [err200];
                        } else {
                          vErrors.push(err200);
                        }
                        errors++;
                      }
                      if (typeof data83 == "number") {
                        if (data83 > 36e5 || isNaN(data83)) {
                          const err201 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/9/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                          if (vErrors === null) {
                            vErrors = [err201];
                          } else {
                            vErrors.push(err201);
                          }
                          errors++;
                        }
                        if (data83 < 100 || isNaN(data83)) {
                          const err202 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/9/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                          if (vErrors === null) {
                            vErrors = [err202];
                          } else {
                            vErrors.push(err202);
                          }
                          errors++;
                        }
                      }
                    }
                    if (data.operation !== void 0) {
                      let data84 = data.operation;
                      if (!(data84 === "navigate" || data84 === "read" || data84 === "click" || data84 === "fill" || data84 === "wait" || data84 === "upload" || data84 === "screenshot" || data84 === "download")) {
                        const err203 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/9/properties/operation/enum", keyword: "enum", params: { allowedValues: schema36.oneOf[9].properties.operation.enum }, message: "must be equal to one of the allowed values" };
                        if (vErrors === null) {
                          vErrors = [err203];
                        } else {
                          vErrors.push(err203);
                        }
                        errors++;
                      }
                    }
                    if (data.selector !== void 0) {
                      let data85 = data.selector;
                      if (typeof data85 === "string") {
                        if (func1(data85) > 1e5) {
                          const err204 = { instancePath: instancePath + "/selector", schemaPath: "#/oneOf/9/properties/selector/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                          if (vErrors === null) {
                            vErrors = [err204];
                          } else {
                            vErrors.push(err204);
                          }
                          errors++;
                        }
                      } else {
                        const err205 = { instancePath: instancePath + "/selector", schemaPath: "#/oneOf/9/properties/selector/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                        if (vErrors === null) {
                          vErrors = [err205];
                        } else {
                          vErrors.push(err205);
                        }
                        errors++;
                      }
                    }
                    if (data.value !== void 0) {
                      if (!validate54(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData, dynamicAnchors })) {
                        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                        errors = vErrors.length;
                      }
                    }
                    if (data.framePath !== void 0) {
                      if (!validate84(data.framePath, { instancePath: instancePath + "/framePath", parentData: data, parentDataProperty: "framePath", rootData, dynamicAnchors })) {
                        vErrors = vErrors === null ? validate84.errors : vErrors.concat(validate84.errors);
                        errors = vErrors.length;
                      }
                    }
                  } else {
                    const err206 = { instancePath, schemaPath: "#/oneOf/9/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                    if (vErrors === null) {
                      vErrors = [err206];
                    } else {
                      vErrors.push(err206);
                    }
                    errors++;
                  }
                  var _valid0 = _errs140 === errors;
                  if (_valid0 && valid0) {
                    valid0 = false;
                    passing0 = [passing0, 9];
                  } else {
                    if (_valid0) {
                      valid0 = true;
                      passing0 = 9;
                      if (props1 !== true) {
                        props1 = true;
                      }
                    }
                    const _errs162 = errors;
                    const _errs165 = errors;
                    let valid19 = true;
                    const _errs166 = errors;
                    if (data && typeof data == "object" && !Array.isArray(data)) {
                      if (data.operation !== void 0) {
                        let data88 = data.operation;
                        if (!(data88 === "navigate" || data88 === "screenshot")) {
                          const err207 = {};
                          if (vErrors === null) {
                            vErrors = [err207];
                          } else {
                            vErrors.push(err207);
                          }
                          errors++;
                        }
                      }
                    }
                    var _valid2 = _errs166 === errors;
                    errors = _errs165;
                    if (vErrors !== null) {
                      if (_errs165) {
                        vErrors.length = _errs165;
                      } else {
                        vErrors = null;
                      }
                    }
                    if (_valid2) {
                      const _errs168 = errors;
                      if (data && typeof data == "object" && !Array.isArray(data)) {
                        if (data.framePath !== void 0) {
                          let data89 = data.framePath;
                          if (Array.isArray(data89)) {
                            if (data89.length > 0) {
                              const err208 = { instancePath: instancePath + "/framePath", schemaPath: "#/oneOf/10/allOf/0/then/properties/framePath/maxItems", keyword: "maxItems", params: { limit: 0 }, message: "must NOT have more than 0 items" };
                              if (vErrors === null) {
                                vErrors = [err208];
                              } else {
                                vErrors.push(err208);
                              }
                              errors++;
                            }
                          }
                        }
                      }
                      var _valid2 = _errs168 === errors;
                      valid19 = _valid2;
                      if (valid19) {
                        var props20 = {};
                        props20.framePath = true;
                        props20.operation = true;
                      }
                    }
                    if (!valid19) {
                      const err209 = { instancePath, schemaPath: "#/oneOf/10/allOf/0/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
                      if (vErrors === null) {
                        vErrors = [err209];
                      } else {
                        vErrors.push(err209);
                      }
                      errors++;
                    }
                    if (data && typeof data == "object" && !Array.isArray(data)) {
                      if (data.id === void 0) {
                        const err210 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                        if (vErrors === null) {
                          vErrors = [err210];
                        } else {
                          vErrors.push(err210);
                        }
                        errors++;
                      }
                      if (data.type === void 0) {
                        const err211 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                        if (vErrors === null) {
                          vErrors = [err211];
                        } else {
                          vErrors.push(err211);
                        }
                        errors++;
                      }
                      if (data.version === void 0) {
                        const err212 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                        if (vErrors === null) {
                          vErrors = [err212];
                        } else {
                          vErrors.push(err212);
                        }
                        errors++;
                      }
                      if (data.operation === void 0) {
                        const err213 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
                        if (vErrors === null) {
                          vErrors = [err213];
                        } else {
                          vErrors.push(err213);
                        }
                        errors++;
                      }
                      if (data.selector === void 0) {
                        const err214 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "selector" }, message: "must have required property 'selector'" };
                        if (vErrors === null) {
                          vErrors = [err214];
                        } else {
                          vErrors.push(err214);
                        }
                        errors++;
                      }
                      if (data.value === void 0) {
                        const err215 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                        if (vErrors === null) {
                          vErrors = [err215];
                        } else {
                          vErrors.push(err215);
                        }
                        errors++;
                      }
                      if (data.framePath === void 0) {
                        const err216 = { instancePath, schemaPath: "#/oneOf/10/required", keyword: "required", params: { missingProperty: "framePath" }, message: "must have required property 'framePath'" };
                        if (vErrors === null) {
                          vErrors = [err216];
                        } else {
                          vErrors.push(err216);
                        }
                        errors++;
                      }
                      for (const key11 in data) {
                        if (!func4.call(schema36.oneOf[10].properties, key11)) {
                          const err217 = { instancePath, schemaPath: "#/oneOf/10/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key11 }, message: "must NOT have additional properties" };
                          if (vErrors === null) {
                            vErrors = [err217];
                          } else {
                            vErrors.push(err217);
                          }
                          errors++;
                        }
                      }
                      if (data.id !== void 0) {
                        let data90 = data.id;
                        if (typeof data90 === "string") {
                          if (!pattern3.test(data90)) {
                            const err218 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/10/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                            if (vErrors === null) {
                              vErrors = [err218];
                            } else {
                              vErrors.push(err218);
                            }
                            errors++;
                          }
                        } else {
                          const err219 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/10/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                          if (vErrors === null) {
                            vErrors = [err219];
                          } else {
                            vErrors.push(err219);
                          }
                          errors++;
                        }
                      }
                      if (data.type !== void 0) {
                        if ("browser" !== data.type) {
                          const err220 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/10/properties/type/const", keyword: "const", params: { allowedValue: "browser" }, message: "must be equal to constant" };
                          if (vErrors === null) {
                            vErrors = [err220];
                          } else {
                            vErrors.push(err220);
                          }
                          errors++;
                        }
                      }
                      if (data.version !== void 0) {
                        if (3 !== data.version) {
                          const err221 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/10/properties/version/const", keyword: "const", params: { allowedValue: 3 }, message: "must be equal to constant" };
                          if (vErrors === null) {
                            vErrors = [err221];
                          } else {
                            vErrors.push(err221);
                          }
                          errors++;
                        }
                      }
                      if (data.name !== void 0) {
                        let data93 = data.name;
                        if (typeof data93 === "string") {
                          if (func1(data93) > 1e5) {
                            const err222 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/10/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                            if (vErrors === null) {
                              vErrors = [err222];
                            } else {
                              vErrors.push(err222);
                            }
                            errors++;
                          }
                        } else {
                          const err223 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/10/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                          if (vErrors === null) {
                            vErrors = [err223];
                          } else {
                            vErrors.push(err223);
                          }
                          errors++;
                        }
                      }
                      if (data.timeoutMs !== void 0) {
                        let data94 = data.timeoutMs;
                        if (!(typeof data94 == "number" && (!(data94 % 1) && !isNaN(data94)))) {
                          const err224 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/10/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                          if (vErrors === null) {
                            vErrors = [err224];
                          } else {
                            vErrors.push(err224);
                          }
                          errors++;
                        }
                        if (typeof data94 == "number") {
                          if (data94 > 36e5 || isNaN(data94)) {
                            const err225 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/10/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                            if (vErrors === null) {
                              vErrors = [err225];
                            } else {
                              vErrors.push(err225);
                            }
                            errors++;
                          }
                          if (data94 < 100 || isNaN(data94)) {
                            const err226 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/10/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                            if (vErrors === null) {
                              vErrors = [err226];
                            } else {
                              vErrors.push(err226);
                            }
                            errors++;
                          }
                        }
                      }
                      if (data.operation !== void 0) {
                        let data95 = data.operation;
                        if (!(data95 === "navigate" || data95 === "read" || data95 === "click" || data95 === "fill" || data95 === "wait" || data95 === "upload" || data95 === "screenshot" || data95 === "download" || data95 === "select" || data95 === "check" || data95 === "inputValue" || data95 === "press")) {
                          const err227 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/10/properties/operation/enum", keyword: "enum", params: { allowedValues: schema36.oneOf[10].properties.operation.enum }, message: "must be equal to one of the allowed values" };
                          if (vErrors === null) {
                            vErrors = [err227];
                          } else {
                            vErrors.push(err227);
                          }
                          errors++;
                        }
                      }
                      if (data.selector !== void 0) {
                        let data96 = data.selector;
                        if (typeof data96 === "string") {
                          if (func1(data96) > 1e5) {
                            const err228 = { instancePath: instancePath + "/selector", schemaPath: "#/oneOf/10/properties/selector/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                            if (vErrors === null) {
                              vErrors = [err228];
                            } else {
                              vErrors.push(err228);
                            }
                            errors++;
                          }
                        } else {
                          const err229 = { instancePath: instancePath + "/selector", schemaPath: "#/oneOf/10/properties/selector/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                          if (vErrors === null) {
                            vErrors = [err229];
                          } else {
                            vErrors.push(err229);
                          }
                          errors++;
                        }
                      }
                      if (data.value !== void 0) {
                        if (!validate54(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData, dynamicAnchors })) {
                          vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                          errors = vErrors.length;
                        }
                      }
                      if (data.framePath !== void 0) {
                        if (!validate84(data.framePath, { instancePath: instancePath + "/framePath", parentData: data, parentDataProperty: "framePath", rootData, dynamicAnchors })) {
                          vErrors = vErrors === null ? validate84.errors : vErrors.concat(validate84.errors);
                          errors = vErrors.length;
                        }
                      }
                    } else {
                      const err230 = { instancePath, schemaPath: "#/oneOf/10/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                      if (vErrors === null) {
                        vErrors = [err230];
                      } else {
                        vErrors.push(err230);
                      }
                      errors++;
                    }
                    var _valid0 = _errs162 === errors;
                    if (_valid0 && valid0) {
                      valid0 = false;
                      passing0 = [passing0, 10];
                    } else {
                      if (_valid0) {
                        valid0 = true;
                        passing0 = 10;
                        if (props1 !== true) {
                          props1 = true;
                        }
                      }
                      const _errs184 = errors;
                      if (data && typeof data == "object" && !Array.isArray(data)) {
                        if (data.id === void 0) {
                          const err231 = { instancePath, schemaPath: "#/oneOf/11/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                          if (vErrors === null) {
                            vErrors = [err231];
                          } else {
                            vErrors.push(err231);
                          }
                          errors++;
                        }
                        if (data.type === void 0) {
                          const err232 = { instancePath, schemaPath: "#/oneOf/11/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                          if (vErrors === null) {
                            vErrors = [err232];
                          } else {
                            vErrors.push(err232);
                          }
                          errors++;
                        }
                        if (data.version === void 0) {
                          const err233 = { instancePath, schemaPath: "#/oneOf/11/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                          if (vErrors === null) {
                            vErrors = [err233];
                          } else {
                            vErrors.push(err233);
                          }
                          errors++;
                        }
                        if (data.message === void 0) {
                          const err234 = { instancePath, schemaPath: "#/oneOf/11/required", keyword: "required", params: { missingProperty: "message" }, message: "must have required property 'message'" };
                          if (vErrors === null) {
                            vErrors = [err234];
                          } else {
                            vErrors.push(err234);
                          }
                          errors++;
                        }
                        for (const key12 in data) {
                          if (!(key12 === "id" || key12 === "type" || key12 === "version" || key12 === "name" || key12 === "timeoutMs" || key12 === "message")) {
                            const err235 = { instancePath, schemaPath: "#/oneOf/11/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key12 }, message: "must NOT have additional properties" };
                            if (vErrors === null) {
                              vErrors = [err235];
                            } else {
                              vErrors.push(err235);
                            }
                            errors++;
                          }
                        }
                        if (data.id !== void 0) {
                          let data99 = data.id;
                          if (typeof data99 === "string") {
                            if (!pattern3.test(data99)) {
                              const err236 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/11/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                              if (vErrors === null) {
                                vErrors = [err236];
                              } else {
                                vErrors.push(err236);
                              }
                              errors++;
                            }
                          } else {
                            const err237 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/11/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                            if (vErrors === null) {
                              vErrors = [err237];
                            } else {
                              vErrors.push(err237);
                            }
                            errors++;
                          }
                        }
                        if (data.type !== void 0) {
                          if ("human" !== data.type) {
                            const err238 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/11/properties/type/const", keyword: "const", params: { allowedValue: "human" }, message: "must be equal to constant" };
                            if (vErrors === null) {
                              vErrors = [err238];
                            } else {
                              vErrors.push(err238);
                            }
                            errors++;
                          }
                        }
                        if (data.version !== void 0) {
                          if (1 !== data.version) {
                            const err239 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/11/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
                            if (vErrors === null) {
                              vErrors = [err239];
                            } else {
                              vErrors.push(err239);
                            }
                            errors++;
                          }
                        }
                        if (data.name !== void 0) {
                          let data102 = data.name;
                          if (typeof data102 === "string") {
                            if (func1(data102) > 1e5) {
                              const err240 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/11/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                              if (vErrors === null) {
                                vErrors = [err240];
                              } else {
                                vErrors.push(err240);
                              }
                              errors++;
                            }
                          } else {
                            const err241 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/11/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                            if (vErrors === null) {
                              vErrors = [err241];
                            } else {
                              vErrors.push(err241);
                            }
                            errors++;
                          }
                        }
                        if (data.timeoutMs !== void 0) {
                          let data103 = data.timeoutMs;
                          if (!(typeof data103 == "number" && (!(data103 % 1) && !isNaN(data103)))) {
                            const err242 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/11/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                            if (vErrors === null) {
                              vErrors = [err242];
                            } else {
                              vErrors.push(err242);
                            }
                            errors++;
                          }
                          if (typeof data103 == "number") {
                            if (data103 > 36e5 || isNaN(data103)) {
                              const err243 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/11/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                              if (vErrors === null) {
                                vErrors = [err243];
                              } else {
                                vErrors.push(err243);
                              }
                              errors++;
                            }
                            if (data103 < 100 || isNaN(data103)) {
                              const err244 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/11/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                              if (vErrors === null) {
                                vErrors = [err244];
                              } else {
                                vErrors.push(err244);
                              }
                              errors++;
                            }
                          }
                        }
                        if (data.message !== void 0) {
                          let data104 = data.message;
                          if (typeof data104 === "string") {
                            if (func1(data104) > 1e5) {
                              const err245 = { instancePath: instancePath + "/message", schemaPath: "#/oneOf/11/properties/message/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                              if (vErrors === null) {
                                vErrors = [err245];
                              } else {
                                vErrors.push(err245);
                              }
                              errors++;
                            }
                          } else {
                            const err246 = { instancePath: instancePath + "/message", schemaPath: "#/oneOf/11/properties/message/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                            if (vErrors === null) {
                              vErrors = [err246];
                            } else {
                              vErrors.push(err246);
                            }
                            errors++;
                          }
                        }
                      } else {
                        const err247 = { instancePath, schemaPath: "#/oneOf/11/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                        if (vErrors === null) {
                          vErrors = [err247];
                        } else {
                          vErrors.push(err247);
                        }
                        errors++;
                      }
                      var _valid0 = _errs184 === errors;
                      if (_valid0 && valid0) {
                        valid0 = false;
                        passing0 = [passing0, 11];
                      } else {
                        if (_valid0) {
                          valid0 = true;
                          passing0 = 11;
                          if (props1 !== true) {
                            props1 = true;
                          }
                        }
                        const _errs197 = errors;
                        if (data && typeof data == "object" && !Array.isArray(data)) {
                          if (data.id === void 0) {
                            const err248 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                            if (vErrors === null) {
                              vErrors = [err248];
                            } else {
                              vErrors.push(err248);
                            }
                            errors++;
                          }
                          if (data.type === void 0) {
                            const err249 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                            if (vErrors === null) {
                              vErrors = [err249];
                            } else {
                              vErrors.push(err249);
                            }
                            errors++;
                          }
                          if (data.version === void 0) {
                            const err250 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                            if (vErrors === null) {
                              vErrors = [err250];
                            } else {
                              vErrors.push(err250);
                            }
                            errors++;
                          }
                          if (data.actual === void 0) {
                            const err251 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "actual" }, message: "must have required property 'actual'" };
                            if (vErrors === null) {
                              vErrors = [err251];
                            } else {
                              vErrors.push(err251);
                            }
                            errors++;
                          }
                          if (data.operator === void 0) {
                            const err252 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "operator" }, message: "must have required property 'operator'" };
                            if (vErrors === null) {
                              vErrors = [err252];
                            } else {
                              vErrors.push(err252);
                            }
                            errors++;
                          }
                          if (data.expected === void 0) {
                            const err253 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "expected" }, message: "must have required property 'expected'" };
                            if (vErrors === null) {
                              vErrors = [err253];
                            } else {
                              vErrors.push(err253);
                            }
                            errors++;
                          }
                          if (data.then === void 0) {
                            const err254 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "then" }, message: "must have required property 'then'" };
                            if (vErrors === null) {
                              vErrors = [err254];
                            } else {
                              vErrors.push(err254);
                            }
                            errors++;
                          }
                          if (data.else === void 0) {
                            const err255 = { instancePath, schemaPath: "#/oneOf/12/required", keyword: "required", params: { missingProperty: "else" }, message: "must have required property 'else'" };
                            if (vErrors === null) {
                              vErrors = [err255];
                            } else {
                              vErrors.push(err255);
                            }
                            errors++;
                          }
                          for (const key13 in data) {
                            if (!func4.call(schema36.oneOf[12].properties, key13)) {
                              const err256 = { instancePath, schemaPath: "#/oneOf/12/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key13 }, message: "must NOT have additional properties" };
                              if (vErrors === null) {
                                vErrors = [err256];
                              } else {
                                vErrors.push(err256);
                              }
                              errors++;
                            }
                          }
                          if (data.id !== void 0) {
                            let data105 = data.id;
                            if (typeof data105 === "string") {
                              if (!pattern3.test(data105)) {
                                const err257 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/12/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                                if (vErrors === null) {
                                  vErrors = [err257];
                                } else {
                                  vErrors.push(err257);
                                }
                                errors++;
                              }
                            } else {
                              const err258 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/12/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                              if (vErrors === null) {
                                vErrors = [err258];
                              } else {
                                vErrors.push(err258);
                              }
                              errors++;
                            }
                          }
                          if (data.type !== void 0) {
                            if ("condition" !== data.type) {
                              const err259 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/12/properties/type/const", keyword: "const", params: { allowedValue: "condition" }, message: "must be equal to constant" };
                              if (vErrors === null) {
                                vErrors = [err259];
                              } else {
                                vErrors.push(err259);
                              }
                              errors++;
                            }
                          }
                          if (data.version !== void 0) {
                            if (1 !== data.version) {
                              const err260 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/12/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
                              if (vErrors === null) {
                                vErrors = [err260];
                              } else {
                                vErrors.push(err260);
                              }
                              errors++;
                            }
                          }
                          if (data.name !== void 0) {
                            let data108 = data.name;
                            if (typeof data108 === "string") {
                              if (func1(data108) > 1e5) {
                                const err261 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/12/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                                if (vErrors === null) {
                                  vErrors = [err261];
                                } else {
                                  vErrors.push(err261);
                                }
                                errors++;
                              }
                            } else {
                              const err262 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/12/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                              if (vErrors === null) {
                                vErrors = [err262];
                              } else {
                                vErrors.push(err262);
                              }
                              errors++;
                            }
                          }
                          if (data.timeoutMs !== void 0) {
                            let data109 = data.timeoutMs;
                            if (!(typeof data109 == "number" && (!(data109 % 1) && !isNaN(data109)))) {
                              const err263 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/12/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                              if (vErrors === null) {
                                vErrors = [err263];
                              } else {
                                vErrors.push(err263);
                              }
                              errors++;
                            }
                            if (typeof data109 == "number") {
                              if (data109 > 36e5 || isNaN(data109)) {
                                const err264 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/12/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                                if (vErrors === null) {
                                  vErrors = [err264];
                                } else {
                                  vErrors.push(err264);
                                }
                                errors++;
                              }
                              if (data109 < 100 || isNaN(data109)) {
                                const err265 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/12/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                                if (vErrors === null) {
                                  vErrors = [err265];
                                } else {
                                  vErrors.push(err265);
                                }
                                errors++;
                              }
                            }
                          }
                          if (data.actual !== void 0) {
                            if (!validate54(data.actual, { instancePath: instancePath + "/actual", parentData: data, parentDataProperty: "actual", rootData, dynamicAnchors })) {
                              vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                              errors = vErrors.length;
                            }
                          }
                          if (data.operator !== void 0) {
                            let data111 = data.operator;
                            if (!(data111 === "equals" || data111 === "notEquals" || data111 === "contains" || data111 === "gt" || data111 === "exists")) {
                              const err266 = { instancePath: instancePath + "/operator", schemaPath: "#/oneOf/12/properties/operator/enum", keyword: "enum", params: { allowedValues: schema36.oneOf[12].properties.operator.enum }, message: "must be equal to one of the allowed values" };
                              if (vErrors === null) {
                                vErrors = [err266];
                              } else {
                                vErrors.push(err266);
                              }
                              errors++;
                            }
                          }
                          if (data.expected !== void 0) {
                            if (!validate54(data.expected, { instancePath: instancePath + "/expected", parentData: data, parentDataProperty: "expected", rootData, dynamicAnchors })) {
                              vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                              errors = vErrors.length;
                            }
                          }
                          if (data.then !== void 0) {
                            let data113 = data.then;
                            if (Array.isArray(data113)) {
                              if (data113.length > 1e3) {
                                const err267 = { instancePath: instancePath + "/then", schemaPath: "#/oneOf/12/properties/then/maxItems", keyword: "maxItems", params: { limit: 1e3 }, message: "must NOT have more than 1000 items" };
                                if (vErrors === null) {
                                  vErrors = [err267];
                                } else {
                                  vErrors.push(err267);
                                }
                                errors++;
                              }
                              const len1 = data113.length;
                              for (let i1 = 0; i1 < len1; i1++) {
                                if (!wrapper2.validate(data113[i1], { instancePath: instancePath + "/then/" + i1, parentData: data113, parentDataProperty: i1, rootData, dynamicAnchors })) {
                                  vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
                                  errors = vErrors.length;
                                }
                              }
                            } else {
                              const err268 = { instancePath: instancePath + "/then", schemaPath: "#/oneOf/12/properties/then/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                              if (vErrors === null) {
                                vErrors = [err268];
                              } else {
                                vErrors.push(err268);
                              }
                              errors++;
                            }
                          }
                          if (data.else !== void 0) {
                            let data115 = data.else;
                            if (Array.isArray(data115)) {
                              if (data115.length > 1e3) {
                                const err269 = { instancePath: instancePath + "/else", schemaPath: "#/oneOf/12/properties/else/maxItems", keyword: "maxItems", params: { limit: 1e3 }, message: "must NOT have more than 1000 items" };
                                if (vErrors === null) {
                                  vErrors = [err269];
                                } else {
                                  vErrors.push(err269);
                                }
                                errors++;
                              }
                              const len2 = data115.length;
                              for (let i2 = 0; i2 < len2; i2++) {
                                if (!wrapper2.validate(data115[i2], { instancePath: instancePath + "/else/" + i2, parentData: data115, parentDataProperty: i2, rootData, dynamicAnchors })) {
                                  vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
                                  errors = vErrors.length;
                                }
                              }
                            } else {
                              const err270 = { instancePath: instancePath + "/else", schemaPath: "#/oneOf/12/properties/else/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                              if (vErrors === null) {
                                vErrors = [err270];
                              } else {
                                vErrors.push(err270);
                              }
                              errors++;
                            }
                          }
                        } else {
                          const err271 = { instancePath, schemaPath: "#/oneOf/12/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                          if (vErrors === null) {
                            vErrors = [err271];
                          } else {
                            vErrors.push(err271);
                          }
                          errors++;
                        }
                        var _valid0 = _errs197 === errors;
                        if (_valid0 && valid0) {
                          valid0 = false;
                          passing0 = [passing0, 12];
                        } else {
                          if (_valid0) {
                            valid0 = true;
                            passing0 = 12;
                            if (props1 !== true) {
                              props1 = true;
                            }
                          }
                          const _errs217 = errors;
                          if (data && typeof data == "object" && !Array.isArray(data)) {
                            if (data.id === void 0) {
                              const err272 = { instancePath, schemaPath: "#/oneOf/13/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                              if (vErrors === null) {
                                vErrors = [err272];
                              } else {
                                vErrors.push(err272);
                              }
                              errors++;
                            }
                            if (data.type === void 0) {
                              const err273 = { instancePath, schemaPath: "#/oneOf/13/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                              if (vErrors === null) {
                                vErrors = [err273];
                              } else {
                                vErrors.push(err273);
                              }
                              errors++;
                            }
                            if (data.version === void 0) {
                              const err274 = { instancePath, schemaPath: "#/oneOf/13/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                              if (vErrors === null) {
                                vErrors = [err274];
                              } else {
                                vErrors.push(err274);
                              }
                              errors++;
                            }
                            if (data.items === void 0) {
                              const err275 = { instancePath, schemaPath: "#/oneOf/13/required", keyword: "required", params: { missingProperty: "items" }, message: "must have required property 'items'" };
                              if (vErrors === null) {
                                vErrors = [err275];
                              } else {
                                vErrors.push(err275);
                              }
                              errors++;
                            }
                            if (data.body === void 0) {
                              const err276 = { instancePath, schemaPath: "#/oneOf/13/required", keyword: "required", params: { missingProperty: "body" }, message: "must have required property 'body'" };
                              if (vErrors === null) {
                                vErrors = [err276];
                              } else {
                                vErrors.push(err276);
                              }
                              errors++;
                            }
                            for (const key14 in data) {
                              if (!(key14 === "id" || key14 === "type" || key14 === "version" || key14 === "name" || key14 === "timeoutMs" || key14 === "items" || key14 === "body")) {
                                const err277 = { instancePath, schemaPath: "#/oneOf/13/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key14 }, message: "must NOT have additional properties" };
                                if (vErrors === null) {
                                  vErrors = [err277];
                                } else {
                                  vErrors.push(err277);
                                }
                                errors++;
                              }
                            }
                            if (data.id !== void 0) {
                              let data117 = data.id;
                              if (typeof data117 === "string") {
                                if (!pattern3.test(data117)) {
                                  const err278 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/13/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                                  if (vErrors === null) {
                                    vErrors = [err278];
                                  } else {
                                    vErrors.push(err278);
                                  }
                                  errors++;
                                }
                              } else {
                                const err279 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/13/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                if (vErrors === null) {
                                  vErrors = [err279];
                                } else {
                                  vErrors.push(err279);
                                }
                                errors++;
                              }
                            }
                            if (data.type !== void 0) {
                              if ("loop" !== data.type) {
                                const err280 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/13/properties/type/const", keyword: "const", params: { allowedValue: "loop" }, message: "must be equal to constant" };
                                if (vErrors === null) {
                                  vErrors = [err280];
                                } else {
                                  vErrors.push(err280);
                                }
                                errors++;
                              }
                            }
                            if (data.version !== void 0) {
                              if (1 !== data.version) {
                                const err281 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/13/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
                                if (vErrors === null) {
                                  vErrors = [err281];
                                } else {
                                  vErrors.push(err281);
                                }
                                errors++;
                              }
                            }
                            if (data.name !== void 0) {
                              let data120 = data.name;
                              if (typeof data120 === "string") {
                                if (func1(data120) > 1e5) {
                                  const err282 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/13/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                                  if (vErrors === null) {
                                    vErrors = [err282];
                                  } else {
                                    vErrors.push(err282);
                                  }
                                  errors++;
                                }
                              } else {
                                const err283 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/13/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                if (vErrors === null) {
                                  vErrors = [err283];
                                } else {
                                  vErrors.push(err283);
                                }
                                errors++;
                              }
                            }
                            if (data.timeoutMs !== void 0) {
                              let data121 = data.timeoutMs;
                              if (!(typeof data121 == "number" && (!(data121 % 1) && !isNaN(data121)))) {
                                const err284 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/13/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                                if (vErrors === null) {
                                  vErrors = [err284];
                                } else {
                                  vErrors.push(err284);
                                }
                                errors++;
                              }
                              if (typeof data121 == "number") {
                                if (data121 > 36e5 || isNaN(data121)) {
                                  const err285 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/13/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                                  if (vErrors === null) {
                                    vErrors = [err285];
                                  } else {
                                    vErrors.push(err285);
                                  }
                                  errors++;
                                }
                                if (data121 < 100 || isNaN(data121)) {
                                  const err286 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/13/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                                  if (vErrors === null) {
                                    vErrors = [err286];
                                  } else {
                                    vErrors.push(err286);
                                  }
                                  errors++;
                                }
                              }
                            }
                            if (data.items !== void 0) {
                              if (!validate54(data.items, { instancePath: instancePath + "/items", parentData: data, parentDataProperty: "items", rootData, dynamicAnchors })) {
                                vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                                errors = vErrors.length;
                              }
                            }
                            if (data.body !== void 0) {
                              let data123 = data.body;
                              if (Array.isArray(data123)) {
                                if (data123.length > 1e3) {
                                  const err287 = { instancePath: instancePath + "/body", schemaPath: "#/oneOf/13/properties/body/maxItems", keyword: "maxItems", params: { limit: 1e3 }, message: "must NOT have more than 1000 items" };
                                  if (vErrors === null) {
                                    vErrors = [err287];
                                  } else {
                                    vErrors.push(err287);
                                  }
                                  errors++;
                                }
                                const len3 = data123.length;
                                for (let i3 = 0; i3 < len3; i3++) {
                                  if (!wrapper2.validate(data123[i3], { instancePath: instancePath + "/body/" + i3, parentData: data123, parentDataProperty: i3, rootData, dynamicAnchors })) {
                                    vErrors = vErrors === null ? wrapper2.validate.errors : vErrors.concat(wrapper2.validate.errors);
                                    errors = vErrors.length;
                                  }
                                }
                              } else {
                                const err288 = { instancePath: instancePath + "/body", schemaPath: "#/oneOf/13/properties/body/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                                if (vErrors === null) {
                                  vErrors = [err288];
                                } else {
                                  vErrors.push(err288);
                                }
                                errors++;
                              }
                            }
                          } else {
                            const err289 = { instancePath, schemaPath: "#/oneOf/13/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                            if (vErrors === null) {
                              vErrors = [err289];
                            } else {
                              vErrors.push(err289);
                            }
                            errors++;
                          }
                          var _valid0 = _errs217 === errors;
                          if (_valid0 && valid0) {
                            valid0 = false;
                            passing0 = [passing0, 13];
                          } else {
                            if (_valid0) {
                              valid0 = true;
                              passing0 = 13;
                              if (props1 !== true) {
                                props1 = true;
                              }
                            }
                            const _errs232 = errors;
                            if (data && typeof data == "object" && !Array.isArray(data)) {
                              if (data.id === void 0) {
                                const err290 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                                if (vErrors === null) {
                                  vErrors = [err290];
                                } else {
                                  vErrors.push(err290);
                                }
                                errors++;
                              }
                              if (data.type === void 0) {
                                const err291 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                                if (vErrors === null) {
                                  vErrors = [err291];
                                } else {
                                  vErrors.push(err291);
                                }
                                errors++;
                              }
                              if (data.version === void 0) {
                                const err292 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                                if (vErrors === null) {
                                  vErrors = [err292];
                                } else {
                                  vErrors.push(err292);
                                }
                                errors++;
                              }
                              if (data.operation === void 0) {
                                const err293 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
                                if (vErrors === null) {
                                  vErrors = [err293];
                                } else {
                                  vErrors.push(err293);
                                }
                                errors++;
                              }
                              if (data.binding === void 0) {
                                const err294 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
                                if (vErrors === null) {
                                  vErrors = [err294];
                                } else {
                                  vErrors.push(err294);
                                }
                                errors++;
                              }
                              if (data.name === void 0) {
                                const err295 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
                                if (vErrors === null) {
                                  vErrors = [err295];
                                } else {
                                  vErrors.push(err295);
                                }
                                errors++;
                              }
                              if (data.sheet === void 0) {
                                const err296 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "sheet" }, message: "must have required property 'sheet'" };
                                if (vErrors === null) {
                                  vErrors = [err296];
                                } else {
                                  vErrors.push(err296);
                                }
                                errors++;
                              }
                              if (data.rows === void 0) {
                                const err297 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "rows" }, message: "must have required property 'rows'" };
                                if (vErrors === null) {
                                  vErrors = [err297];
                                } else {
                                  vErrors.push(err297);
                                }
                                errors++;
                              }
                              if (data.mappings === void 0) {
                                const err298 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "mappings" }, message: "must have required property 'mappings'" };
                                if (vErrors === null) {
                                  vErrors = [err298];
                                } else {
                                  vErrors.push(err298);
                                }
                                errors++;
                              }
                              if (data.includeHeaders === void 0) {
                                const err299 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "includeHeaders" }, message: "must have required property 'includeHeaders'" };
                                if (vErrors === null) {
                                  vErrors = [err299];
                                } else {
                                  vErrors.push(err299);
                                }
                                errors++;
                              }
                              if (data.nullPolicy === void 0) {
                                const err300 = { instancePath, schemaPath: "#/oneOf/14/required", keyword: "required", params: { missingProperty: "nullPolicy" }, message: "must have required property 'nullPolicy'" };
                                if (vErrors === null) {
                                  vErrors = [err300];
                                } else {
                                  vErrors.push(err300);
                                }
                                errors++;
                              }
                              for (const key15 in data) {
                                if (!func4.call(schema36.oneOf[14].properties, key15)) {
                                  const err301 = { instancePath, schemaPath: "#/oneOf/14/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key15 }, message: "must NOT have additional properties" };
                                  if (vErrors === null) {
                                    vErrors = [err301];
                                  } else {
                                    vErrors.push(err301);
                                  }
                                  errors++;
                                }
                              }
                              if (data.id !== void 0) {
                                let data125 = data.id;
                                if (typeof data125 === "string") {
                                  if (!pattern3.test(data125)) {
                                    const err302 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/14/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                                    if (vErrors === null) {
                                      vErrors = [err302];
                                    } else {
                                      vErrors.push(err302);
                                    }
                                    errors++;
                                  }
                                } else {
                                  const err303 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/14/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                  if (vErrors === null) {
                                    vErrors = [err303];
                                  } else {
                                    vErrors.push(err303);
                                  }
                                  errors++;
                                }
                              }
                              if (data.type !== void 0) {
                                if ("excel" !== data.type) {
                                  const err304 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/14/properties/type/const", keyword: "const", params: { allowedValue: "excel" }, message: "must be equal to constant" };
                                  if (vErrors === null) {
                                    vErrors = [err304];
                                  } else {
                                    vErrors.push(err304);
                                  }
                                  errors++;
                                }
                              }
                              if (data.version !== void 0) {
                                if (3 !== data.version) {
                                  const err305 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/14/properties/version/const", keyword: "const", params: { allowedValue: 3 }, message: "must be equal to constant" };
                                  if (vErrors === null) {
                                    vErrors = [err305];
                                  } else {
                                    vErrors.push(err305);
                                  }
                                  errors++;
                                }
                              }
                              if (data.operation !== void 0) {
                                if ("map" !== data.operation) {
                                  const err306 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/14/properties/operation/const", keyword: "const", params: { allowedValue: "map" }, message: "must be equal to constant" };
                                  if (vErrors === null) {
                                    vErrors = [err306];
                                  } else {
                                    vErrors.push(err306);
                                  }
                                  errors++;
                                }
                              }
                              if (data.binding !== void 0) {
                                let data129 = data.binding;
                                if (typeof data129 === "string") {
                                  if (func1(data129) > 1e5) {
                                    const err307 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/14/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                                    if (vErrors === null) {
                                      vErrors = [err307];
                                    } else {
                                      vErrors.push(err307);
                                    }
                                    errors++;
                                  }
                                  if (func1(data129) < 1) {
                                    const err308 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/14/properties/binding/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                    if (vErrors === null) {
                                      vErrors = [err308];
                                    } else {
                                      vErrors.push(err308);
                                    }
                                    errors++;
                                  }
                                } else {
                                  const err309 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/14/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                  if (vErrors === null) {
                                    vErrors = [err309];
                                  } else {
                                    vErrors.push(err309);
                                  }
                                  errors++;
                                }
                              }
                              if (data.name !== void 0) {
                                if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
                                  vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                                  errors = vErrors.length;
                                }
                              }
                              if (data.sheet !== void 0) {
                                let data131 = data.sheet;
                                if (typeof data131 === "string") {
                                  if (func1(data131) > 31) {
                                    const err310 = { instancePath: instancePath + "/sheet", schemaPath: "#/oneOf/14/properties/sheet/maxLength", keyword: "maxLength", params: { limit: 31 }, message: "must NOT have more than 31 characters" };
                                    if (vErrors === null) {
                                      vErrors = [err310];
                                    } else {
                                      vErrors.push(err310);
                                    }
                                    errors++;
                                  }
                                  if (func1(data131) < 1) {
                                    const err311 = { instancePath: instancePath + "/sheet", schemaPath: "#/oneOf/14/properties/sheet/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                    if (vErrors === null) {
                                      vErrors = [err311];
                                    } else {
                                      vErrors.push(err311);
                                    }
                                    errors++;
                                  }
                                } else {
                                  const err312 = { instancePath: instancePath + "/sheet", schemaPath: "#/oneOf/14/properties/sheet/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                  if (vErrors === null) {
                                    vErrors = [err312];
                                  } else {
                                    vErrors.push(err312);
                                  }
                                  errors++;
                                }
                              }
                              if (data.rows !== void 0) {
                                if (!validate54(data.rows, { instancePath: instancePath + "/rows", parentData: data, parentDataProperty: "rows", rootData, dynamicAnchors })) {
                                  vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                                  errors = vErrors.length;
                                }
                              }
                              if (data.mappings !== void 0) {
                                let data133 = data.mappings;
                                if (Array.isArray(data133)) {
                                  if (data133.length > 256) {
                                    const err313 = { instancePath: instancePath + "/mappings", schemaPath: "#/oneOf/14/properties/mappings/maxItems", keyword: "maxItems", params: { limit: 256 }, message: "must NOT have more than 256 items" };
                                    if (vErrors === null) {
                                      vErrors = [err313];
                                    } else {
                                      vErrors.push(err313);
                                    }
                                    errors++;
                                  }
                                  if (data133.length < 1) {
                                    const err314 = { instancePath: instancePath + "/mappings", schemaPath: "#/oneOf/14/properties/mappings/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
                                    if (vErrors === null) {
                                      vErrors = [err314];
                                    } else {
                                      vErrors.push(err314);
                                    }
                                    errors++;
                                  }
                                  const len4 = data133.length;
                                  for (let i4 = 0; i4 < len4; i4++) {
                                    if (!validate120(data133[i4], { instancePath: instancePath + "/mappings/" + i4, parentData: data133, parentDataProperty: i4, rootData, dynamicAnchors })) {
                                      vErrors = vErrors === null ? validate120.errors : vErrors.concat(validate120.errors);
                                      errors = vErrors.length;
                                    }
                                  }
                                } else {
                                  const err315 = { instancePath: instancePath + "/mappings", schemaPath: "#/oneOf/14/properties/mappings/type", keyword: "type", params: { type: "array" }, message: "must be array" };
                                  if (vErrors === null) {
                                    vErrors = [err315];
                                  } else {
                                    vErrors.push(err315);
                                  }
                                  errors++;
                                }
                              }
                              if (data.includeHeaders !== void 0) {
                                if (typeof data.includeHeaders !== "boolean") {
                                  const err316 = { instancePath: instancePath + "/includeHeaders", schemaPath: "#/oneOf/14/properties/includeHeaders/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
                                  if (vErrors === null) {
                                    vErrors = [err316];
                                  } else {
                                    vErrors.push(err316);
                                  }
                                  errors++;
                                }
                              }
                              if (data.nullPolicy !== void 0) {
                                if ("blank" !== data.nullPolicy) {
                                  const err317 = { instancePath: instancePath + "/nullPolicy", schemaPath: "#/oneOf/14/properties/nullPolicy/const", keyword: "const", params: { allowedValue: "blank" }, message: "must be equal to constant" };
                                  if (vErrors === null) {
                                    vErrors = [err317];
                                  } else {
                                    vErrors.push(err317);
                                  }
                                  errors++;
                                }
                              }
                              if (data.timeoutMs !== void 0) {
                                let data137 = data.timeoutMs;
                                if (!(typeof data137 == "number" && (!(data137 % 1) && !isNaN(data137)))) {
                                  const err318 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/14/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                                  if (vErrors === null) {
                                    vErrors = [err318];
                                  } else {
                                    vErrors.push(err318);
                                  }
                                  errors++;
                                }
                                if (typeof data137 == "number") {
                                  if (data137 > 36e5 || isNaN(data137)) {
                                    const err319 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/14/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                                    if (vErrors === null) {
                                      vErrors = [err319];
                                    } else {
                                      vErrors.push(err319);
                                    }
                                    errors++;
                                  }
                                  if (data137 < 100 || isNaN(data137)) {
                                    const err320 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/14/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                                    if (vErrors === null) {
                                      vErrors = [err320];
                                    } else {
                                      vErrors.push(err320);
                                    }
                                    errors++;
                                  }
                                }
                              }
                            } else {
                              const err321 = { instancePath, schemaPath: "#/oneOf/14/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                              if (vErrors === null) {
                                vErrors = [err321];
                              } else {
                                vErrors.push(err321);
                              }
                              errors++;
                            }
                            var _valid0 = _errs232 === errors;
                            if (_valid0 && valid0) {
                              valid0 = false;
                              passing0 = [passing0, 14];
                            } else {
                              if (_valid0) {
                                valid0 = true;
                                passing0 = 14;
                                if (props1 !== true) {
                                  props1 = true;
                                }
                              }
                              const _errs254 = errors;
                              if (data && typeof data == "object" && !Array.isArray(data)) {
                                if (data.id === void 0) {
                                  const err322 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                                  if (vErrors === null) {
                                    vErrors = [err322];
                                  } else {
                                    vErrors.push(err322);
                                  }
                                  errors++;
                                }
                                if (data.type === void 0) {
                                  const err323 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                                  if (vErrors === null) {
                                    vErrors = [err323];
                                  } else {
                                    vErrors.push(err323);
                                  }
                                  errors++;
                                }
                                if (data.version === void 0) {
                                  const err324 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                                  if (vErrors === null) {
                                    vErrors = [err324];
                                  } else {
                                    vErrors.push(err324);
                                  }
                                  errors++;
                                }
                                if (data.operation === void 0) {
                                  const err325 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
                                  if (vErrors === null) {
                                    vErrors = [err325];
                                  } else {
                                    vErrors.push(err325);
                                  }
                                  errors++;
                                }
                                if (data.binding === void 0) {
                                  const err326 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
                                  if (vErrors === null) {
                                    vErrors = [err326];
                                  } else {
                                    vErrors.push(err326);
                                  }
                                  errors++;
                                }
                                if (data.name === void 0) {
                                  const err327 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
                                  if (vErrors === null) {
                                    vErrors = [err327];
                                  } else {
                                    vErrors.push(err327);
                                  }
                                  errors++;
                                }
                                if (data.content === void 0) {
                                  const err328 = { instancePath, schemaPath: "#/oneOf/15/required", keyword: "required", params: { missingProperty: "content" }, message: "must have required property 'content'" };
                                  if (vErrors === null) {
                                    vErrors = [err328];
                                  } else {
                                    vErrors.push(err328);
                                  }
                                  errors++;
                                }
                                for (const key16 in data) {
                                  if (!(key16 === "id" || key16 === "type" || key16 === "version" || key16 === "name" || key16 === "timeoutMs" || key16 === "operation" || key16 === "binding" || key16 === "content")) {
                                    const err329 = { instancePath, schemaPath: "#/oneOf/15/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key16 }, message: "must NOT have additional properties" };
                                    if (vErrors === null) {
                                      vErrors = [err329];
                                    } else {
                                      vErrors.push(err329);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.id !== void 0) {
                                  let data138 = data.id;
                                  if (typeof data138 === "string") {
                                    if (!pattern3.test(data138)) {
                                      const err330 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/15/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                                      if (vErrors === null) {
                                        vErrors = [err330];
                                      } else {
                                        vErrors.push(err330);
                                      }
                                      errors++;
                                    }
                                  } else {
                                    const err331 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/15/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                    if (vErrors === null) {
                                      vErrors = [err331];
                                    } else {
                                      vErrors.push(err331);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.type !== void 0) {
                                  if ("file" !== data.type) {
                                    const err332 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/15/properties/type/const", keyword: "const", params: { allowedValue: "file" }, message: "must be equal to constant" };
                                    if (vErrors === null) {
                                      vErrors = [err332];
                                    } else {
                                      vErrors.push(err332);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.version !== void 0) {
                                  if (3 !== data.version) {
                                    const err333 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/15/properties/version/const", keyword: "const", params: { allowedValue: 3 }, message: "must be equal to constant" };
                                    if (vErrors === null) {
                                      vErrors = [err333];
                                    } else {
                                      vErrors.push(err333);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.name !== void 0) {
                                  if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
                                    vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                                    errors = vErrors.length;
                                  }
                                }
                                if (data.timeoutMs !== void 0) {
                                  let data142 = data.timeoutMs;
                                  if (!(typeof data142 == "number" && (!(data142 % 1) && !isNaN(data142)))) {
                                    const err334 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/15/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                                    if (vErrors === null) {
                                      vErrors = [err334];
                                    } else {
                                      vErrors.push(err334);
                                    }
                                    errors++;
                                  }
                                  if (typeof data142 == "number") {
                                    if (data142 > 36e5 || isNaN(data142)) {
                                      const err335 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/15/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                                      if (vErrors === null) {
                                        vErrors = [err335];
                                      } else {
                                        vErrors.push(err335);
                                      }
                                      errors++;
                                    }
                                    if (data142 < 100 || isNaN(data142)) {
                                      const err336 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/15/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                                      if (vErrors === null) {
                                        vErrors = [err336];
                                      } else {
                                        vErrors.push(err336);
                                      }
                                      errors++;
                                    }
                                  }
                                }
                                if (data.operation !== void 0) {
                                  if ("create" !== data.operation) {
                                    const err337 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/15/properties/operation/const", keyword: "const", params: { allowedValue: "create" }, message: "must be equal to constant" };
                                    if (vErrors === null) {
                                      vErrors = [err337];
                                    } else {
                                      vErrors.push(err337);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.binding !== void 0) {
                                  let data144 = data.binding;
                                  if (typeof data144 === "string") {
                                    if (func1(data144) > 1e5) {
                                      const err338 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/15/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                                      if (vErrors === null) {
                                        vErrors = [err338];
                                      } else {
                                        vErrors.push(err338);
                                      }
                                      errors++;
                                    }
                                  } else {
                                    const err339 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/15/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                    if (vErrors === null) {
                                      vErrors = [err339];
                                    } else {
                                      vErrors.push(err339);
                                    }
                                    errors++;
                                  }
                                }
                                if (data.content !== void 0) {
                                  if (!validate54(data.content, { instancePath: instancePath + "/content", parentData: data, parentDataProperty: "content", rootData, dynamicAnchors })) {
                                    vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                                    errors = vErrors.length;
                                  }
                                }
                              } else {
                                const err340 = { instancePath, schemaPath: "#/oneOf/15/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                if (vErrors === null) {
                                  vErrors = [err340];
                                } else {
                                  vErrors.push(err340);
                                }
                                errors++;
                              }
                              var _valid0 = _errs254 === errors;
                              if (_valid0 && valid0) {
                                valid0 = false;
                                passing0 = [passing0, 15];
                              } else {
                                if (_valid0) {
                                  valid0 = true;
                                  passing0 = 15;
                                  if (props1 !== true) {
                                    props1 = true;
                                  }
                                }
                                const _errs268 = errors;
                                if (data && typeof data == "object" && !Array.isArray(data)) {
                                  if (data.id === void 0) {
                                    const err341 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                                    if (vErrors === null) {
                                      vErrors = [err341];
                                    } else {
                                      vErrors.push(err341);
                                    }
                                    errors++;
                                  }
                                  if (data.type === void 0) {
                                    const err342 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                                    if (vErrors === null) {
                                      vErrors = [err342];
                                    } else {
                                      vErrors.push(err342);
                                    }
                                    errors++;
                                  }
                                  if (data.version === void 0) {
                                    const err343 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                                    if (vErrors === null) {
                                      vErrors = [err343];
                                    } else {
                                      vErrors.push(err343);
                                    }
                                    errors++;
                                  }
                                  if (data.operation === void 0) {
                                    const err344 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
                                    if (vErrors === null) {
                                      vErrors = [err344];
                                    } else {
                                      vErrors.push(err344);
                                    }
                                    errors++;
                                  }
                                  if (data.binding === void 0) {
                                    const err345 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
                                    if (vErrors === null) {
                                      vErrors = [err345];
                                    } else {
                                      vErrors.push(err345);
                                    }
                                    errors++;
                                  }
                                  if (data.name === void 0) {
                                    const err346 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
                                    if (vErrors === null) {
                                      vErrors = [err346];
                                    } else {
                                      vErrors.push(err346);
                                    }
                                    errors++;
                                  }
                                  if (data.content === void 0) {
                                    const err347 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "content" }, message: "must have required property 'content'" };
                                    if (vErrors === null) {
                                      vErrors = [err347];
                                    } else {
                                      vErrors.push(err347);
                                    }
                                    errors++;
                                  }
                                  if (data.onConflict === void 0) {
                                    const err348 = { instancePath, schemaPath: "#/oneOf/16/required", keyword: "required", params: { missingProperty: "onConflict" }, message: "must have required property 'onConflict'" };
                                    if (vErrors === null) {
                                      vErrors = [err348];
                                    } else {
                                      vErrors.push(err348);
                                    }
                                    errors++;
                                  }
                                  for (const key17 in data) {
                                    if (!func4.call(schema36.oneOf[16].properties, key17)) {
                                      const err349 = { instancePath, schemaPath: "#/oneOf/16/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key17 }, message: "must NOT have additional properties" };
                                      if (vErrors === null) {
                                        vErrors = [err349];
                                      } else {
                                        vErrors.push(err349);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.id !== void 0) {
                                    let data146 = data.id;
                                    if (typeof data146 === "string") {
                                      if (!pattern3.test(data146)) {
                                        const err350 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/16/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                                        if (vErrors === null) {
                                          vErrors = [err350];
                                        } else {
                                          vErrors.push(err350);
                                        }
                                        errors++;
                                      }
                                    } else {
                                      const err351 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/16/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                      if (vErrors === null) {
                                        vErrors = [err351];
                                      } else {
                                        vErrors.push(err351);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.type !== void 0) {
                                    if ("file" !== data.type) {
                                      const err352 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/16/properties/type/const", keyword: "const", params: { allowedValue: "file" }, message: "must be equal to constant" };
                                      if (vErrors === null) {
                                        vErrors = [err352];
                                      } else {
                                        vErrors.push(err352);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.version !== void 0) {
                                    if (4 !== data.version) {
                                      const err353 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/16/properties/version/const", keyword: "const", params: { allowedValue: 4 }, message: "must be equal to constant" };
                                      if (vErrors === null) {
                                        vErrors = [err353];
                                      } else {
                                        vErrors.push(err353);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.name !== void 0) {
                                    if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
                                      vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                                      errors = vErrors.length;
                                    }
                                  }
                                  if (data.timeoutMs !== void 0) {
                                    let data150 = data.timeoutMs;
                                    if (!(typeof data150 == "number" && (!(data150 % 1) && !isNaN(data150)))) {
                                      const err354 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/16/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                                      if (vErrors === null) {
                                        vErrors = [err354];
                                      } else {
                                        vErrors.push(err354);
                                      }
                                      errors++;
                                    }
                                    if (typeof data150 == "number") {
                                      if (data150 > 36e5 || isNaN(data150)) {
                                        const err355 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/16/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                                        if (vErrors === null) {
                                          vErrors = [err355];
                                        } else {
                                          vErrors.push(err355);
                                        }
                                        errors++;
                                      }
                                      if (data150 < 100 || isNaN(data150)) {
                                        const err356 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/16/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                                        if (vErrors === null) {
                                          vErrors = [err356];
                                        } else {
                                          vErrors.push(err356);
                                        }
                                        errors++;
                                      }
                                    }
                                  }
                                  if (data.operation !== void 0) {
                                    if ("create" !== data.operation) {
                                      const err357 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/16/properties/operation/const", keyword: "const", params: { allowedValue: "create" }, message: "must be equal to constant" };
                                      if (vErrors === null) {
                                        vErrors = [err357];
                                      } else {
                                        vErrors.push(err357);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.binding !== void 0) {
                                    let data152 = data.binding;
                                    if (typeof data152 === "string") {
                                      if (func1(data152) > 1e5) {
                                        const err358 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/16/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                                        if (vErrors === null) {
                                          vErrors = [err358];
                                        } else {
                                          vErrors.push(err358);
                                        }
                                        errors++;
                                      }
                                    } else {
                                      const err359 = { instancePath: instancePath + "/binding", schemaPath: "#/oneOf/16/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                      if (vErrors === null) {
                                        vErrors = [err359];
                                      } else {
                                        vErrors.push(err359);
                                      }
                                      errors++;
                                    }
                                  }
                                  if (data.content !== void 0) {
                                    if (!validate54(data.content, { instancePath: instancePath + "/content", parentData: data, parentDataProperty: "content", rootData, dynamicAnchors })) {
                                      vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                                      errors = vErrors.length;
                                    }
                                  }
                                  if (data.onConflict !== void 0) {
                                    if ("number" !== data.onConflict) {
                                      const err360 = { instancePath: instancePath + "/onConflict", schemaPath: "#/oneOf/16/properties/onConflict/const", keyword: "const", params: { allowedValue: "number" }, message: "must be equal to constant" };
                                      if (vErrors === null) {
                                        vErrors = [err360];
                                      } else {
                                        vErrors.push(err360);
                                      }
                                      errors++;
                                    }
                                  }
                                } else {
                                  const err361 = { instancePath, schemaPath: "#/oneOf/16/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                  if (vErrors === null) {
                                    vErrors = [err361];
                                  } else {
                                    vErrors.push(err361);
                                  }
                                  errors++;
                                }
                                var _valid0 = _errs268 === errors;
                                if (_valid0 && valid0) {
                                  valid0 = false;
                                  passing0 = [passing0, 16];
                                } else {
                                  if (_valid0) {
                                    valid0 = true;
                                    passing0 = 16;
                                    if (props1 !== true) {
                                      props1 = true;
                                    }
                                  }
                                  const _errs283 = errors;
                                  if (data && typeof data == "object" && !Array.isArray(data)) {
                                    if (data.id === void 0) {
                                      const err362 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                                      if (vErrors === null) {
                                        vErrors = [err362];
                                      } else {
                                        vErrors.push(err362);
                                      }
                                      errors++;
                                    }
                                    if (data.type === void 0) {
                                      const err363 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                                      if (vErrors === null) {
                                        vErrors = [err363];
                                      } else {
                                        vErrors.push(err363);
                                      }
                                      errors++;
                                    }
                                    if (data.version === void 0) {
                                      const err364 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                                      if (vErrors === null) {
                                        vErrors = [err364];
                                      } else {
                                        vErrors.push(err364);
                                      }
                                      errors++;
                                    }
                                    if (data.target === void 0) {
                                      const err365 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
                                      if (vErrors === null) {
                                        vErrors = [err365];
                                      } else {
                                        vErrors.push(err365);
                                      }
                                      errors++;
                                    }
                                    if (data.tool === void 0) {
                                      const err366 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "tool" }, message: "must have required property 'tool'" };
                                      if (vErrors === null) {
                                        vErrors = [err366];
                                      } else {
                                        vErrors.push(err366);
                                      }
                                      errors++;
                                    }
                                    if (data.arguments === void 0) {
                                      const err367 = { instancePath, schemaPath: "#/oneOf/17/required", keyword: "required", params: { missingProperty: "arguments" }, message: "must have required property 'arguments'" };
                                      if (vErrors === null) {
                                        vErrors = [err367];
                                      } else {
                                        vErrors.push(err367);
                                      }
                                      errors++;
                                    }
                                    for (const key18 in data) {
                                      if (!(key18 === "id" || key18 === "type" || key18 === "version" || key18 === "name" || key18 === "timeoutMs" || key18 === "target" || key18 === "tool" || key18 === "arguments")) {
                                        const err368 = { instancePath, schemaPath: "#/oneOf/17/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key18 }, message: "must NOT have additional properties" };
                                        if (vErrors === null) {
                                          vErrors = [err368];
                                        } else {
                                          vErrors.push(err368);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.id !== void 0) {
                                      let data155 = data.id;
                                      if (typeof data155 === "string") {
                                        if (!pattern3.test(data155)) {
                                          const err369 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/17/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                                          if (vErrors === null) {
                                            vErrors = [err369];
                                          } else {
                                            vErrors.push(err369);
                                          }
                                          errors++;
                                        }
                                      } else {
                                        const err370 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/17/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                        if (vErrors === null) {
                                          vErrors = [err370];
                                        } else {
                                          vErrors.push(err370);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.type !== void 0) {
                                      if ("mcp" !== data.type) {
                                        const err371 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/17/properties/type/const", keyword: "const", params: { allowedValue: "mcp" }, message: "must be equal to constant" };
                                        if (vErrors === null) {
                                          vErrors = [err371];
                                        } else {
                                          vErrors.push(err371);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.version !== void 0) {
                                      if (1 !== data.version) {
                                        const err372 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/17/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
                                        if (vErrors === null) {
                                          vErrors = [err372];
                                        } else {
                                          vErrors.push(err372);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.name !== void 0) {
                                      let data158 = data.name;
                                      if (typeof data158 === "string") {
                                        if (func1(data158) > 1e5) {
                                          const err373 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/17/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                                          if (vErrors === null) {
                                            vErrors = [err373];
                                          } else {
                                            vErrors.push(err373);
                                          }
                                          errors++;
                                        }
                                      } else {
                                        const err374 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/17/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                        if (vErrors === null) {
                                          vErrors = [err374];
                                        } else {
                                          vErrors.push(err374);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.timeoutMs !== void 0) {
                                      let data159 = data.timeoutMs;
                                      if (!(typeof data159 == "number" && (!(data159 % 1) && !isNaN(data159)))) {
                                        const err375 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/17/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                                        if (vErrors === null) {
                                          vErrors = [err375];
                                        } else {
                                          vErrors.push(err375);
                                        }
                                        errors++;
                                      }
                                      if (typeof data159 == "number") {
                                        if (data159 > 36e5 || isNaN(data159)) {
                                          const err376 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/17/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
                                          if (vErrors === null) {
                                            vErrors = [err376];
                                          } else {
                                            vErrors.push(err376);
                                          }
                                          errors++;
                                        }
                                        if (data159 < 100 || isNaN(data159)) {
                                          const err377 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/17/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                                          if (vErrors === null) {
                                            vErrors = [err377];
                                          } else {
                                            vErrors.push(err377);
                                          }
                                          errors++;
                                        }
                                      }
                                    }
                                    if (data.target !== void 0) {
                                      let data160 = data.target;
                                      if (typeof data160 === "string") {
                                        if (!pattern3.test(data160)) {
                                          const err378 = { instancePath: instancePath + "/target", schemaPath: "#/oneOf/17/properties/target/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                                          if (vErrors === null) {
                                            vErrors = [err378];
                                          } else {
                                            vErrors.push(err378);
                                          }
                                          errors++;
                                        }
                                      } else {
                                        const err379 = { instancePath: instancePath + "/target", schemaPath: "#/oneOf/17/properties/target/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                        if (vErrors === null) {
                                          vErrors = [err379];
                                        } else {
                                          vErrors.push(err379);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.tool !== void 0) {
                                      let data161 = data.tool;
                                      if (typeof data161 === "string") {
                                        if (func1(data161) > 500) {
                                          const err380 = { instancePath: instancePath + "/tool", schemaPath: "#/oneOf/17/properties/tool/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
                                          if (vErrors === null) {
                                            vErrors = [err380];
                                          } else {
                                            vErrors.push(err380);
                                          }
                                          errors++;
                                        }
                                        if (func1(data161) < 1) {
                                          const err381 = { instancePath: instancePath + "/tool", schemaPath: "#/oneOf/17/properties/tool/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                          if (vErrors === null) {
                                            vErrors = [err381];
                                          } else {
                                            vErrors.push(err381);
                                          }
                                          errors++;
                                        }
                                      } else {
                                        const err382 = { instancePath: instancePath + "/tool", schemaPath: "#/oneOf/17/properties/tool/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                        if (vErrors === null) {
                                          vErrors = [err382];
                                        } else {
                                          vErrors.push(err382);
                                        }
                                        errors++;
                                      }
                                    }
                                    if (data.arguments !== void 0) {
                                      if (!validate54(data.arguments, { instancePath: instancePath + "/arguments", parentData: data, parentDataProperty: "arguments", rootData, dynamicAnchors })) {
                                        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
                                        errors = vErrors.length;
                                      }
                                    }
                                  } else {
                                    const err383 = { instancePath, schemaPath: "#/oneOf/17/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                    if (vErrors === null) {
                                      vErrors = [err383];
                                    } else {
                                      vErrors.push(err383);
                                    }
                                    errors++;
                                  }
                                  var _valid0 = _errs283 === errors;
                                  if (_valid0 && valid0) {
                                    valid0 = false;
                                    passing0 = [passing0, 17];
                                  } else {
                                    if (_valid0) {
                                      valid0 = true;
                                      passing0 = 17;
                                      if (props1 !== true) {
                                        props1 = true;
                                      }
                                    }
                                    const _errs299 = errors;
                                    if (data && typeof data == "object" && !Array.isArray(data)) {
                                      if (data.id === void 0) {
                                        const err384 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                                        if (vErrors === null) {
                                          vErrors = [err384];
                                        } else {
                                          vErrors.push(err384);
                                        }
                                        errors++;
                                      }
                                      if (data.type === void 0) {
                                        const err385 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
                                        if (vErrors === null) {
                                          vErrors = [err385];
                                        } else {
                                          vErrors.push(err385);
                                        }
                                        errors++;
                                      }
                                      if (data.version === void 0) {
                                        const err386 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
                                        if (vErrors === null) {
                                          vErrors = [err386];
                                        } else {
                                          vErrors.push(err386);
                                        }
                                        errors++;
                                      }
                                      if (data.target === void 0) {
                                        const err387 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
                                        if (vErrors === null) {
                                          vErrors = [err387];
                                        } else {
                                          vErrors.push(err387);
                                        }
                                        errors++;
                                      }
                                      if (data.operation === void 0) {
                                        const err388 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
                                        if (vErrors === null) {
                                          vErrors = [err388];
                                        } else {
                                          vErrors.push(err388);
                                        }
                                        errors++;
                                      }
                                      if (data.text === void 0) {
                                        const err389 = { instancePath, schemaPath: "#/oneOf/18/required", keyword: "required", params: { missingProperty: "text" }, message: "must have required property 'text'" };
                                        if (vErrors === null) {
                                          vErrors = [err389];
                                        } else {
                                          vErrors.push(err389);
                                        }
                                        errors++;
                                      }
                                      for (const key19 in data) {
                                        if (!(key19 === "id" || key19 === "type" || key19 === "version" || key19 === "name" || key19 === "timeoutMs" || key19 === "target" || key19 === "operation" || key19 === "text")) {
                                          const err390 = { instancePath, schemaPath: "#/oneOf/18/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key19 }, message: "must NOT have additional properties" };
                                          if (vErrors === null) {
                                            vErrors = [err390];
                                          } else {
                                            vErrors.push(err390);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.id !== void 0) {
                                        let data163 = data.id;
                                        if (typeof data163 === "string") {
                                          if (!pattern3.test(data163)) {
                                            const err391 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/18/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                                            if (vErrors === null) {
                                              vErrors = [err391];
                                            } else {
                                              vErrors.push(err391);
                                            }
                                            errors++;
                                          }
                                        } else {
                                          const err392 = { instancePath: instancePath + "/id", schemaPath: "#/oneOf/18/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                          if (vErrors === null) {
                                            vErrors = [err392];
                                          } else {
                                            vErrors.push(err392);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.type !== void 0) {
                                        if ("desktop" !== data.type) {
                                          const err393 = { instancePath: instancePath + "/type", schemaPath: "#/oneOf/18/properties/type/const", keyword: "const", params: { allowedValue: "desktop" }, message: "must be equal to constant" };
                                          if (vErrors === null) {
                                            vErrors = [err393];
                                          } else {
                                            vErrors.push(err393);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.version !== void 0) {
                                        if (1 !== data.version) {
                                          const err394 = { instancePath: instancePath + "/version", schemaPath: "#/oneOf/18/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
                                          if (vErrors === null) {
                                            vErrors = [err394];
                                          } else {
                                            vErrors.push(err394);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.name !== void 0) {
                                        let data166 = data.name;
                                        if (typeof data166 === "string") {
                                          if (func1(data166) > 1e5) {
                                            const err395 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/18/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
                                            if (vErrors === null) {
                                              vErrors = [err395];
                                            } else {
                                              vErrors.push(err395);
                                            }
                                            errors++;
                                          }
                                        } else {
                                          const err396 = { instancePath: instancePath + "/name", schemaPath: "#/oneOf/18/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                          if (vErrors === null) {
                                            vErrors = [err396];
                                          } else {
                                            vErrors.push(err396);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.timeoutMs !== void 0) {
                                        let data167 = data.timeoutMs;
                                        if (!(typeof data167 == "number" && (!(data167 % 1) && !isNaN(data167)))) {
                                          const err397 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/18/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                                          if (vErrors === null) {
                                            vErrors = [err397];
                                          } else {
                                            vErrors.push(err397);
                                          }
                                          errors++;
                                        }
                                        if (typeof data167 == "number") {
                                          if (data167 > 6e4 || isNaN(data167)) {
                                            const err398 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/18/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e4 }, message: "must be <= 60000" };
                                            if (vErrors === null) {
                                              vErrors = [err398];
                                            } else {
                                              vErrors.push(err398);
                                            }
                                            errors++;
                                          }
                                          if (data167 < 100 || isNaN(data167)) {
                                            const err399 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/oneOf/18/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
                                            if (vErrors === null) {
                                              vErrors = [err399];
                                            } else {
                                              vErrors.push(err399);
                                            }
                                            errors++;
                                          }
                                        }
                                      }
                                      if (data.target !== void 0) {
                                        let data168 = data.target;
                                        if (typeof data168 === "string") {
                                          if (!pattern3.test(data168)) {
                                            const err400 = { instancePath: instancePath + "/target", schemaPath: "#/oneOf/18/properties/target/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
                                            if (vErrors === null) {
                                              vErrors = [err400];
                                            } else {
                                              vErrors.push(err400);
                                            }
                                            errors++;
                                          }
                                        } else {
                                          const err401 = { instancePath: instancePath + "/target", schemaPath: "#/oneOf/18/properties/target/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                          if (vErrors === null) {
                                            vErrors = [err401];
                                          } else {
                                            vErrors.push(err401);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.operation !== void 0) {
                                        if ("replace-selection" !== data.operation) {
                                          const err402 = { instancePath: instancePath + "/operation", schemaPath: "#/oneOf/18/properties/operation/const", keyword: "const", params: { allowedValue: "replace-selection" }, message: "must be equal to constant" };
                                          if (vErrors === null) {
                                            vErrors = [err402];
                                          } else {
                                            vErrors.push(err402);
                                          }
                                          errors++;
                                        }
                                      }
                                      if (data.text !== void 0) {
                                        let data170 = data.text;
                                        if (typeof data170 === "string") {
                                          if (func1(data170) > 2e4) {
                                            const err403 = { instancePath: instancePath + "/text", schemaPath: "#/oneOf/18/properties/text/maxLength", keyword: "maxLength", params: { limit: 2e4 }, message: "must NOT have more than 20000 characters" };
                                            if (vErrors === null) {
                                              vErrors = [err403];
                                            } else {
                                              vErrors.push(err403);
                                            }
                                            errors++;
                                          }
                                          if (func1(data170) < 1) {
                                            const err404 = { instancePath: instancePath + "/text", schemaPath: "#/oneOf/18/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                                            if (vErrors === null) {
                                              vErrors = [err404];
                                            } else {
                                              vErrors.push(err404);
                                            }
                                            errors++;
                                          }
                                        } else {
                                          const err405 = { instancePath: instancePath + "/text", schemaPath: "#/oneOf/18/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                                          if (vErrors === null) {
                                            vErrors = [err405];
                                          } else {
                                            vErrors.push(err405);
                                          }
                                          errors++;
                                        }
                                      }
                                    } else {
                                      const err406 = { instancePath, schemaPath: "#/oneOf/18/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                                      if (vErrors === null) {
                                        vErrors = [err406];
                                      } else {
                                        vErrors.push(err406);
                                      }
                                      errors++;
                                    }
                                    var _valid0 = _errs299 === errors;
                                    if (_valid0 && valid0) {
                                      valid0 = false;
                                      passing0 = [passing0, 18];
                                    } else {
                                      if (_valid0) {
                                        valid0 = true;
                                        passing0 = 18;
                                        if (props1 !== true) {
                                          props1 = true;
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  if (!valid0) {
    const err407 = { instancePath, schemaPath: "#/oneOf", keyword: "oneOf", params: { passingSchemas: passing0 }, message: "must match exactly one schema in oneOf" };
    if (vErrors === null) {
      vErrors = [err407];
    } else {
      vErrors.push(err407);
    }
    errors++;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate93.errors = vErrors;
  evaluated0.props = props1;
  return errors === 0;
}
validate93.evaluated = { "dynamicProps": true, "dynamicItems": false };
function validate90(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate90.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.actual === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "actual" }, message: "must have required property 'actual'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.operator === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operator" }, message: "must have required property 'operator'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.expected === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "expected" }, message: "must have required property 'expected'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.then === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "then" }, message: "must have required property 'then'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.else === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "else" }, message: "must have required property 'else'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func4.call(schema35.properties, key0)) {
        const err8 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err9 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("condition" !== data.type) {
        const err11 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "condition" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err12 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err13 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      } else {
        const err14 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err15 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err16 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err17 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      }
    }
    if (data.actual !== void 0) {
      if (!validate54(data.actual, { instancePath: instancePath + "/actual", parentData: data, parentDataProperty: "actual", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.operator !== void 0) {
      let data6 = data.operator;
      if (!(data6 === "equals" || data6 === "notEquals" || data6 === "contains" || data6 === "gt" || data6 === "exists")) {
        const err18 = { instancePath: instancePath + "/operator", schemaPath: "#/properties/operator/enum", keyword: "enum", params: { allowedValues: schema35.properties.operator.enum }, message: "must be equal to one of the allowed values" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.expected !== void 0) {
      if (!validate54(data.expected, { instancePath: instancePath + "/expected", parentData: data, parentDataProperty: "expected", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.then !== void 0) {
      let data8 = data.then;
      if (Array.isArray(data8)) {
        if (data8.length > 1e3) {
          const err19 = { instancePath: instancePath + "/then", schemaPath: "#/properties/then/maxItems", keyword: "maxItems", params: { limit: 1e3 }, message: "must NOT have more than 1000 items" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
        const len0 = data8.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate93(data8[i0], { instancePath: instancePath + "/then/" + i0, parentData: data8, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate93.errors : vErrors.concat(validate93.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err20 = { instancePath: instancePath + "/then", schemaPath: "#/properties/then/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
    if (data.else !== void 0) {
      let data10 = data.else;
      if (Array.isArray(data10)) {
        if (data10.length > 1e3) {
          const err21 = { instancePath: instancePath + "/else", schemaPath: "#/properties/else/maxItems", keyword: "maxItems", params: { limit: 1e3 }, message: "must NOT have more than 1000 items" };
          if (vErrors === null) {
            vErrors = [err21];
          } else {
            vErrors.push(err21);
          }
          errors++;
        }
        const len1 = data10.length;
        for (let i1 = 0; i1 < len1; i1++) {
          if (!validate93(data10[i1], { instancePath: instancePath + "/else/" + i1, parentData: data10, parentDataProperty: i1, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate93.errors : vErrors.concat(validate93.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err22 = { instancePath: instancePath + "/else", schemaPath: "#/properties/else/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
  } else {
    const err23 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err23];
    } else {
      vErrors.push(err23);
    }
    errors++;
  }
  validate90.errors = vErrors;
  return errors === 0;
}
validate90.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_loop_1 = validate129;
function validate129(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate129.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.items === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "items" }, message: "must have required property 'items'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.body === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "body" }, message: "must have required property 'body'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "items" || key0 === "body")) {
        const err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err6 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      } else {
        const err7 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("loop" !== data.type) {
        const err8 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "loop" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err9 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err10 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      } else {
        const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err12 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      }
    }
    if (data.items !== void 0) {
      if (!validate54(data.items, { instancePath: instancePath + "/items", parentData: data, parentDataProperty: "items", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.body !== void 0) {
      let data6 = data.body;
      if (Array.isArray(data6)) {
        if (data6.length > 1e3) {
          const err15 = { instancePath: instancePath + "/body", schemaPath: "#/properties/body/maxItems", keyword: "maxItems", params: { limit: 1e3 }, message: "must NOT have more than 1000 items" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
        const len0 = data6.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate93(data6[i0], { instancePath: instancePath + "/body/" + i0, parentData: data6, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate93.errors : vErrors.concat(validate93.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err16 = { instancePath: instancePath + "/body", schemaPath: "#/properties/body/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
  } else {
    const err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err17];
    } else {
      vErrors.push(err17);
    }
    errors++;
  }
  validate129.errors = vErrors;
  return errors === 0;
}
validate129.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_excel_3 = validate132;
var schema39 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "excel" }, "version": { "const": 3 }, "operation": { "const": "map" }, "binding": { "type": "string", "minLength": 1, "maxLength": 1e5 }, "name": { "$ref": "#/$defs/Value" }, "sheet": { "type": "string", "minLength": 1, "maxLength": 31 }, "rows": { "$ref": "#/$defs/Value" }, "mappings": { "type": "array", "minItems": 1, "maxItems": 256, "items": { "$ref": "#/$defs/ExcelColumnMapping" } }, "includeHeaders": { "type": "boolean" }, "nullPolicy": { "const": "blank" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 } }, "required": ["id", "type", "version", "operation", "binding", "name", "sheet", "rows", "mappings", "includeHeaders", "nullPolicy"], "additionalProperties": false };
function validate132(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate132.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.sheet === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sheet" }, message: "must have required property 'sheet'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.rows === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rows" }, message: "must have required property 'rows'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    if (data.mappings === void 0) {
      const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "mappings" }, message: "must have required property 'mappings'" };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    if (data.includeHeaders === void 0) {
      const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "includeHeaders" }, message: "must have required property 'includeHeaders'" };
      if (vErrors === null) {
        vErrors = [err9];
      } else {
        vErrors.push(err9);
      }
      errors++;
    }
    if (data.nullPolicy === void 0) {
      const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "nullPolicy" }, message: "must have required property 'nullPolicy'" };
      if (vErrors === null) {
        vErrors = [err10];
      } else {
        vErrors.push(err10);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func4.call(schema39.properties, key0)) {
        const err11 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err12 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      } else {
        const err13 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("excel" !== data.type) {
        const err14 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "excel" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (3 !== data.version) {
        const err15 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 3 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.operation !== void 0) {
      if ("map" !== data.operation) {
        const err16 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/const", keyword: "const", params: { allowedValue: "map" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      let data4 = data.binding;
      if (typeof data4 === "string") {
        if (func1(data4) > 1e5) {
          const err17 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
        if (func1(data4) < 1) {
          const err18 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
      } else {
        const err19 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.sheet !== void 0) {
      let data6 = data.sheet;
      if (typeof data6 === "string") {
        if (func1(data6) > 31) {
          const err20 = { instancePath: instancePath + "/sheet", schemaPath: "#/properties/sheet/maxLength", keyword: "maxLength", params: { limit: 31 }, message: "must NOT have more than 31 characters" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
        if (func1(data6) < 1) {
          const err21 = { instancePath: instancePath + "/sheet", schemaPath: "#/properties/sheet/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err21];
          } else {
            vErrors.push(err21);
          }
          errors++;
        }
      } else {
        const err22 = { instancePath: instancePath + "/sheet", schemaPath: "#/properties/sheet/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
    }
    if (data.rows !== void 0) {
      if (!validate54(data.rows, { instancePath: instancePath + "/rows", parentData: data, parentDataProperty: "rows", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.mappings !== void 0) {
      let data8 = data.mappings;
      if (Array.isArray(data8)) {
        if (data8.length > 256) {
          const err23 = { instancePath: instancePath + "/mappings", schemaPath: "#/properties/mappings/maxItems", keyword: "maxItems", params: { limit: 256 }, message: "must NOT have more than 256 items" };
          if (vErrors === null) {
            vErrors = [err23];
          } else {
            vErrors.push(err23);
          }
          errors++;
        }
        if (data8.length < 1) {
          const err24 = { instancePath: instancePath + "/mappings", schemaPath: "#/properties/mappings/minItems", keyword: "minItems", params: { limit: 1 }, message: "must NOT have fewer than 1 items" };
          if (vErrors === null) {
            vErrors = [err24];
          } else {
            vErrors.push(err24);
          }
          errors++;
        }
        const len0 = data8.length;
        for (let i0 = 0; i0 < len0; i0++) {
          if (!validate120(data8[i0], { instancePath: instancePath + "/mappings/" + i0, parentData: data8, parentDataProperty: i0, rootData, dynamicAnchors })) {
            vErrors = vErrors === null ? validate120.errors : vErrors.concat(validate120.errors);
            errors = vErrors.length;
          }
        }
      } else {
        const err25 = { instancePath: instancePath + "/mappings", schemaPath: "#/properties/mappings/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
    }
    if (data.includeHeaders !== void 0) {
      if (typeof data.includeHeaders !== "boolean") {
        const err26 = { instancePath: instancePath + "/includeHeaders", schemaPath: "#/properties/includeHeaders/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
    }
    if (data.nullPolicy !== void 0) {
      if ("blank" !== data.nullPolicy) {
        const err27 = { instancePath: instancePath + "/nullPolicy", schemaPath: "#/properties/nullPolicy/const", keyword: "const", params: { allowedValue: "blank" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data12 = data.timeoutMs;
      if (!(typeof data12 == "number" && (!(data12 % 1) && !isNaN(data12)))) {
        const err28 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
      if (typeof data12 == "number") {
        if (data12 > 36e5 || isNaN(data12)) {
          const err29 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err29];
          } else {
            vErrors.push(err29);
          }
          errors++;
        }
        if (data12 < 100 || isNaN(data12)) {
          const err30 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
      }
    }
  } else {
    const err31 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err31];
    } else {
      vErrors.push(err31);
    }
    errors++;
  }
  validate132.errors = vErrors;
  return errors === 0;
}
validate132.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_file_3 = validate136;
function validate136(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate136.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.content === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "content" }, message: "must have required property 'content'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "operation" || key0 === "binding" || key0 === "content")) {
        const err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      } else {
        const err9 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("file" !== data.type) {
        const err10 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "file" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (3 !== data.version) {
        const err11 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 3 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err12 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
      }
    }
    if (data.operation !== void 0) {
      if ("create" !== data.operation) {
        const err15 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/const", keyword: "const", params: { allowedValue: "create" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      let data6 = data.binding;
      if (typeof data6 === "string") {
        if (func1(data6) > 1e5) {
          const err16 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.content !== void 0) {
      if (!validate54(data.content, { instancePath: instancePath + "/content", parentData: data, parentDataProperty: "content", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err18 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err18];
    } else {
      vErrors.push(err18);
    }
    errors++;
  }
  validate136.errors = vErrors;
  return errors === 0;
}
validate136.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_file_4 = validate139;
var schema41 = { "type": "object", "properties": { "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,100}$" }, "type": { "const": "file" }, "version": { "const": 4 }, "name": { "$ref": "#/$defs/Value" }, "timeoutMs": { "type": "integer", "minimum": 100, "maximum": 36e5 }, "operation": { "const": "create" }, "binding": { "type": "string", "maxLength": 1e5 }, "content": { "$ref": "#/$defs/Value" }, "onConflict": { "const": "number" } }, "required": ["id", "type", "version", "operation", "binding", "name", "content", "onConflict"], "additionalProperties": false };
function validate139(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate139.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.binding === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.name === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    if (data.content === void 0) {
      const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "content" }, message: "must have required property 'content'" };
      if (vErrors === null) {
        vErrors = [err6];
      } else {
        vErrors.push(err6);
      }
      errors++;
    }
    if (data.onConflict === void 0) {
      const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "onConflict" }, message: "must have required property 'onConflict'" };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!func4.call(schema41.properties, key0)) {
        const err8 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err9 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      } else {
        const err10 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("file" !== data.type) {
        const err11 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "file" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (4 !== data.version) {
        const err12 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 4 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      if (!validate54(data.name, { instancePath: instancePath + "/name", parentData: data, parentDataProperty: "name", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err15 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      }
    }
    if (data.operation !== void 0) {
      if ("create" !== data.operation) {
        const err16 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/const", keyword: "const", params: { allowedValue: "create" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
    }
    if (data.binding !== void 0) {
      let data6 = data.binding;
      if (typeof data6 === "string") {
        if (func1(data6) > 1e5) {
          const err17 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      } else {
        const err18 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.content !== void 0) {
      if (!validate54(data.content, { instancePath: instancePath + "/content", parentData: data, parentDataProperty: "content", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
    if (data.onConflict !== void 0) {
      if ("number" !== data.onConflict) {
        const err19 = { instancePath: instancePath + "/onConflict", schemaPath: "#/properties/onConflict/const", keyword: "const", params: { allowedValue: "number" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
    }
  } else {
    const err20 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err20];
    } else {
      vErrors.push(err20);
    }
    errors++;
  }
  validate139.errors = vErrors;
  return errors === 0;
}
validate139.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_mcp_1 = validate142;
function validate142(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate142.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.target === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.tool === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tool" }, message: "must have required property 'tool'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.arguments === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "arguments" }, message: "must have required property 'arguments'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "target" || key0 === "tool" || key0 === "arguments")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("mcp" !== data.type) {
        const err9 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "mcp" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err10 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 36e5 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 36e5 }, message: "must be <= 3600000" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err15 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      }
    }
    if (data.target !== void 0) {
      let data5 = data.target;
      if (typeof data5 === "string") {
        if (!pattern3.test(data5)) {
          const err16 = { instancePath: instancePath + "/target", schemaPath: "#/properties/target/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/target", schemaPath: "#/properties/target/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.tool !== void 0) {
      let data6 = data.tool;
      if (typeof data6 === "string") {
        if (func1(data6) > 500) {
          const err18 = { instancePath: instancePath + "/tool", schemaPath: "#/properties/tool/maxLength", keyword: "maxLength", params: { limit: 500 }, message: "must NOT have more than 500 characters" };
          if (vErrors === null) {
            vErrors = [err18];
          } else {
            vErrors.push(err18);
          }
          errors++;
        }
        if (func1(data6) < 1) {
          const err19 = { instancePath: instancePath + "/tool", schemaPath: "#/properties/tool/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
      } else {
        const err20 = { instancePath: instancePath + "/tool", schemaPath: "#/properties/tool/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
    }
    if (data.arguments !== void 0) {
      if (!validate54(data.arguments, { instancePath: instancePath + "/arguments", parentData: data, parentDataProperty: "arguments", rootData, dynamicAnchors })) {
        vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
        errors = vErrors.length;
      }
    }
  } else {
    const err21 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err21];
    } else {
      vErrors.push(err21);
    }
    errors++;
  }
  validate142.errors = vErrors;
  return errors === 0;
}
validate142.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
var node_desktop_1 = validate144;
function validate144(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate144.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      if (vErrors === null) {
        vErrors = [err0];
      } else {
        vErrors.push(err0);
      }
      errors++;
    }
    if (data.type === void 0) {
      const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      if (vErrors === null) {
        vErrors = [err1];
      } else {
        vErrors.push(err1);
      }
      errors++;
    }
    if (data.version === void 0) {
      const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "version" }, message: "must have required property 'version'" };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    if (data.target === void 0) {
      const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    if (data.operation === void 0) {
      const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "operation" }, message: "must have required property 'operation'" };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    if (data.text === void 0) {
      const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "text" }, message: "must have required property 'text'" };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    for (const key0 in data) {
      if (!(key0 === "id" || key0 === "type" || key0 === "version" || key0 === "name" || key0 === "timeoutMs" || key0 === "target" || key0 === "operation" || key0 === "text")) {
        const err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
    }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 === "string") {
        if (!pattern3.test(data0)) {
          const err7 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      } else {
        const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
    }
    if (data.type !== void 0) {
      if ("desktop" !== data.type) {
        const err9 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/const", keyword: "const", params: { allowedValue: "desktop" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
    }
    if (data.version !== void 0) {
      if (1 !== data.version) {
        const err10 = { instancePath: instancePath + "/version", schemaPath: "#/properties/version/const", keyword: "const", params: { allowedValue: 1 }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
    }
    if (data.name !== void 0) {
      let data3 = data.name;
      if (typeof data3 === "string") {
        if (func1(data3) > 1e5) {
          const err11 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/maxLength", keyword: "maxLength", params: { limit: 1e5 }, message: "must NOT have more than 100000 characters" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      } else {
        const err12 = { instancePath: instancePath + "/name", schemaPath: "#/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
    }
    if (data.timeoutMs !== void 0) {
      let data4 = data.timeoutMs;
      if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)))) {
        const err13 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      if (typeof data4 == "number") {
        if (data4 > 6e4 || isNaN(data4)) {
          const err14 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/maximum", keyword: "maximum", params: { comparison: "<=", limit: 6e4 }, message: "must be <= 60000" };
          if (vErrors === null) {
            vErrors = [err14];
          } else {
            vErrors.push(err14);
          }
          errors++;
        }
        if (data4 < 100 || isNaN(data4)) {
          const err15 = { instancePath: instancePath + "/timeoutMs", schemaPath: "#/properties/timeoutMs/minimum", keyword: "minimum", params: { comparison: ">=", limit: 100 }, message: "must be >= 100" };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      }
    }
    if (data.target !== void 0) {
      let data5 = data.target;
      if (typeof data5 === "string") {
        if (!pattern3.test(data5)) {
          const err16 = { instancePath: instancePath + "/target", schemaPath: "#/properties/target/pattern", keyword: "pattern", params: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, message: 'must match pattern "^[a-zA-Z0-9_-]{1,100}$"' };
          if (vErrors === null) {
            vErrors = [err16];
          } else {
            vErrors.push(err16);
          }
          errors++;
        }
      } else {
        const err17 = { instancePath: instancePath + "/target", schemaPath: "#/properties/target/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
    }
    if (data.operation !== void 0) {
      if ("replace-selection" !== data.operation) {
        const err18 = { instancePath: instancePath + "/operation", schemaPath: "#/properties/operation/const", keyword: "const", params: { allowedValue: "replace-selection" }, message: "must be equal to constant" };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
    }
    if (data.text !== void 0) {
      let data7 = data.text;
      if (typeof data7 === "string") {
        if (func1(data7) > 2e4) {
          const err19 = { instancePath: instancePath + "/text", schemaPath: "#/properties/text/maxLength", keyword: "maxLength", params: { limit: 2e4 }, message: "must NOT have more than 20000 characters" };
          if (vErrors === null) {
            vErrors = [err19];
          } else {
            vErrors.push(err19);
          }
          errors++;
        }
        if (func1(data7) < 1) {
          const err20 = { instancePath: instancePath + "/text", schemaPath: "#/properties/text/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err20];
          } else {
            vErrors.push(err20);
          }
          errors++;
        }
      } else {
        const err21 = { instancePath: instancePath + "/text", schemaPath: "#/properties/text/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
    }
  } else {
    const err22 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    if (vErrors === null) {
      vErrors = [err22];
    } else {
      vErrors.push(err22);
    }
    errors++;
  }
  validate144.errors = vErrors;
  return errors === 0;
}
validate144.evaluated = { "props": true, "dynamicProps": false, "dynamicItems": false };
export {
  node_assert_1,
  node_browser_1,
  node_browser_2,
  node_browser_3,
  node_condition_1,
  node_desktop_1,
  node_excel_1,
  node_excel_2,
  node_excel_3,
  node_file_1,
  node_file_2,
  node_file_3,
  node_file_4,
  node_http_1,
  node_human_1,
  node_loop_1,
  node_mcp_1,
  node_script_1,
  node_value_1
};
