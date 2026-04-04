import * as React from "react";
import { Controller, FormProvider, useFormContext } from "react-hook-form";
import { View } from "react-native";

import { isKey, useTranslation } from "@turbostarter/i18n";
import { cn } from "@turbostarter/ui";

import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Label } from "./label";
import { RadioGroup } from "./radio-group";
import { Select } from "./select";
import { Switch } from "./switch";
import { Text } from "./text";
import { Textarea } from "./textarea";

import type { Option } from "./select";
import type {
  ControllerProps,
  FieldPath,
  FieldValues,
  Noop,
} from "react-hook-form";

const Form = FormProvider;

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName;
}

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue,
);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState, handleSubmit } = useFormContext();

  const fieldState = getFieldState(fieldContext.name, formState);

  const { nativeID } = itemContext;

  return {
    nativeID,
    name: fieldContext.name,
    formItemNativeID: `${nativeID}-form-item`,
    formDescriptionNativeID: `${nativeID}-form-item-description`,
    formMessageNativeID: `${nativeID}-form-item-message`,
    handleSubmit,
    ...fieldState,
  };
};

interface FormItemContextValue {
  nativeID: string;
}

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue,
);

function FormItem({ className, ...props }: React.ComponentProps<typeof View>) {
  const nativeID = React.useId();

  return (
    <FormItemContext.Provider value={{ nativeID }}>
      <View className={cn("gap-2", className)} {...props} />
    </FormItemContext.Provider>
  );
}

function FormLabel({
  className,
  nativeID: _nativeID,
  children,
  ref,
  ...props
}: Omit<React.ComponentProps<typeof Label>, "children"> & {
  children: React.ReactNode;
}) {
  const { error, formItemNativeID } = useFormField();

  return (
    <Label
      ref={ref}
      className={cn("px-px", error && "text-destructive", className)}
      nativeID={formItemNativeID}
      {...props}
    >
      {children}
    </Label>
  );
}

function FormDescription({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof Text>) {
  const { formDescriptionNativeID } = useFormField();

  return (
    <Text
      ref={ref}
      nativeID={formDescriptionNativeID}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function FormMessage({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Text>) {
  const { t, i18n } = useTranslation();
  const { error, formMessageNativeID } = useFormField();
  const body = error ? String(error.message) : children;

  if (!body) {
    return null;
  }

  return (
    <Text
      nativeID={formMessageNativeID}
      className={cn("text-destructive text-sm", className)}
      {...props}
    >
      {typeof body === "string" && isKey(body, i18n) ? t(body) : body}
    </Text>
  );
}

type Override<T, U> = Omit<T, keyof U> & U;

interface FormFieldFieldProps<T> {
  name: string;
  onBlur: Noop;
  onChange: (val: T) => void;
  value: T;
  disabled?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FormItemProps<T extends React.ElementType<any>, U> = Override<
  React.ComponentPropsWithoutRef<T>,
  FormFieldFieldProps<U>
> & {
  label?: React.ReactNode;
  description?: React.ReactNode;
};

function FormInput({
  label,
  description,
  onChange,
  ref,
  ...props
}: FormItemProps<typeof Input, string> & {
  ref?: React.Ref<React.ComponentRef<typeof Input>>;
}) {
  const inputRef = React.useRef<React.ComponentRef<typeof Input>>(null);
  const {
    error,
    formItemNativeID,
    formDescriptionNativeID,
    formMessageNativeID,
  } = useFormField();

  React.useImperativeHandle(ref, () => {
    if (!inputRef.current) {
      return {} as React.ComponentRef<typeof Input>;
    }
    return inputRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputRef.current]);

  function handleOnLabelPress() {
    if (!inputRef.current) {
      return;
    }
    if (inputRef.current.isFocused()) {
      inputRef.current.blur();
    } else {
      inputRef.current.focus();
    }
  }

  return (
    <FormItem>
      {!!label && (
        <FormLabel nativeID={formItemNativeID} onPress={handleOnLabelPress}>
          {label}
        </FormLabel>
      )}

      <Input
        ref={inputRef}
        aria-labelledby={formItemNativeID}
        aria-describedby={
          !error
            ? `${formDescriptionNativeID}`
            : `${formDescriptionNativeID} ${formMessageNativeID}`
        }
        aria-invalid={!!error}
        onChangeText={onChange}
        {...props}
      />
      {!!description && <FormDescription>{description}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}

function FormTextarea({
  label,
  description,
  onChange,
  ref,
  ...props
}: FormItemProps<typeof Textarea, string> & {
  ref?: React.Ref<React.ComponentRef<typeof Textarea>>;
}) {
  const textareaRef = React.useRef<React.ComponentRef<typeof Textarea>>(null);
  const {
    error,
    formItemNativeID,
    formDescriptionNativeID,
    formMessageNativeID,
  } = useFormField();

  React.useImperativeHandle(ref, () => {
    if (!textareaRef.current) {
      return {} as React.ComponentRef<typeof Textarea>;
    }
    return textareaRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textareaRef.current]);

  function handleOnLabelPress() {
    if (!textareaRef.current) {
      return;
    }
    if (textareaRef.current.isFocused()) {
      textareaRef.current.blur();
    } else {
      textareaRef.current.focus();
    }
  }

  return (
    <FormItem>
      {!!label && (
        <FormLabel nativeID={formItemNativeID} onPress={handleOnLabelPress}>
          {label}
        </FormLabel>
      )}

      <Textarea
        ref={textareaRef}
        aria-labelledby={formItemNativeID}
        aria-describedby={
          !error
            ? `${formDescriptionNativeID}`
            : `${formDescriptionNativeID} ${formMessageNativeID}`
        }
        aria-invalid={!!error}
        onChangeText={onChange}
        {...props}
      />
      {!!description && <FormDescription>{description}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}

function FormCheckbox({
  label,
  description,
  value,
  onChange,
  ref,
  ...props
}: Omit<
  FormItemProps<typeof Checkbox, boolean>,
  "checked" | "onCheckedChange"
> & { ref?: React.Ref<React.ComponentRef<typeof Checkbox>> }) {
  const {
    error,
    formItemNativeID,
    formDescriptionNativeID,
    formMessageNativeID,
  } = useFormField();

  function handleOnLabelPress() {
    onChange(!value);
  }

  return (
    <FormItem>
      <View className="flex-row items-center gap-2">
        <Checkbox
          ref={ref}
          aria-labelledby={formItemNativeID}
          aria-describedby={
            !error
              ? `${formDescriptionNativeID}`
              : `${formDescriptionNativeID} ${formMessageNativeID}`
          }
          aria-invalid={!!error}
          onCheckedChange={onChange}
          checked={value}
          {...props}
        />
        {!!label && (
          <FormLabel nativeID={formItemNativeID} onPress={handleOnLabelPress}>
            {label}
          </FormLabel>
        )}
      </View>
      {!!description && <FormDescription>{description}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}

function FormRadioGroup({
  label,
  description,
  value,
  onChange,
  ref,
  ...props
}: Omit<FormItemProps<typeof RadioGroup, string>, "onValueChange"> & {
  ref?: React.Ref<React.ComponentRef<typeof RadioGroup>>;
}) {
  const {
    error,
    formItemNativeID,
    formDescriptionNativeID,
    formMessageNativeID,
  } = useFormField();

  return (
    <FormItem className="gap-3">
      <View>
        {!!label && <FormLabel nativeID={formItemNativeID}>{label}</FormLabel>}
        {!!description && (
          <FormDescription className="pt-0">{description}</FormDescription>
        )}
      </View>
      <RadioGroup
        ref={ref}
        aria-labelledby={formItemNativeID}
        aria-describedby={
          !error
            ? `${formDescriptionNativeID}`
            : `${formDescriptionNativeID} ${formMessageNativeID}`
        }
        aria-invalid={!!error}
        onValueChange={onChange}
        value={value}
        {...props}
      />

      <FormMessage />
    </FormItem>
  );
}

function FormSelect({
  label,
  description,
  onChange,
  value,
  ref,
  ...props
}: Omit<
  FormItemProps<typeof Select, Partial<Option>>,
  "open" | "onOpenChange" | "onValueChange"
> & { ref?: React.Ref<React.ComponentRef<typeof Select>> }) {
  const {
    error,
    formItemNativeID,
    formDescriptionNativeID,
    formMessageNativeID,
  } = useFormField();

  return (
    <FormItem>
      {!!label && <FormLabel nativeID={formItemNativeID}>{label}</FormLabel>}
      <Select
        ref={ref}
        aria-labelledby={formItemNativeID}
        aria-describedby={
          !error
            ? `${formDescriptionNativeID}`
            : `${formDescriptionNativeID} ${formMessageNativeID}`
        }
        aria-invalid={!!error}
        value={
          value
            ? { label: value.label ?? "", value: value.label ?? "" }
            : undefined
        }
        onValueChange={onChange}
        {...props}
      />
      {!!description && <FormDescription>{description}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}

function FormSwitch({
  label,
  description,
  value,
  onChange,
  ref,
  ...props
}: Omit<
  FormItemProps<typeof Switch, boolean>,
  "checked" | "onCheckedChange"
> & { ref?: React.Ref<React.ComponentRef<typeof Switch>> }) {
  const switchRef = React.useRef<React.ComponentRef<typeof Switch>>(null);
  const {
    error,
    formItemNativeID,
    formDescriptionNativeID,
    formMessageNativeID,
  } = useFormField();

  React.useImperativeHandle(ref, () => {
    if (!switchRef.current) {
      return {} as React.ComponentRef<typeof Switch>;
    }
    return switchRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchRef.current]);

  function handleOnLabelPress() {
    onChange(!value);
  }

  return (
    <FormItem className="px-1">
      <View className="flex-row items-center gap-3">
        <Switch
          ref={switchRef}
          aria-labelledby={formItemNativeID}
          aria-describedby={
            !error
              ? `${formDescriptionNativeID}`
              : `${formDescriptionNativeID} ${formMessageNativeID}`
          }
          aria-invalid={!!error}
          onCheckedChange={onChange}
          checked={value}
          {...props}
        />
        {!!label && (
          <FormLabel
            className="pb-0"
            nativeID={formItemNativeID}
            onPress={handleOnLabelPress}
          >
            {label}
          </FormLabel>
        )}
      </View>
      {!!description && <FormDescription>{description}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}

export {
  Form,
  FormCheckbox,
  FormDescription,
  FormField,
  FormInput,
  FormItem,
  FormLabel,
  FormMessage,
  FormRadioGroup,
  FormSwitch,
  FormSelect,
  FormTextarea,
  useFormField,
};
