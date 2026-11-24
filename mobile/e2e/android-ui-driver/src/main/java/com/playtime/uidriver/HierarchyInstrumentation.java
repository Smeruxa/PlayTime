package com.playtime.uidriver;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.view.Display;
import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;
import android.util.Xml;
import java.io.File;
import java.io.FileOutputStream;
import java.io.StringWriter;
import org.xmlpull.v1.XmlSerializer;

public final class HierarchyInstrumentation extends Instrumentation {
    private Bundle arguments = new Bundle();

    @Override
    public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        if (arguments != null) this.arguments = arguments;
        start();
    }

    @Override
    public void onStart() {
        Bundle result = new Bundle();
        try {
            UiAutomation automation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            AccessibilityServiceInfo service = automation.getServiceInfo();
            service.flags |= AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
                    | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
            automation.setServiceInfo(service);
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            for (int attempt = 0; root == null && attempt < 10; attempt++) {
                Thread.sleep(50);
                root = automation.getRootInActiveWindow();
            }
            if (root == null) throw new IllegalStateException("No active accessibility window");
            if ("capture".equals(arguments.getString("mode"))) {
                captureRegion(automation, root, result);
                finish(Activity.RESULT_OK, result);
                return;
            }
            StringWriter output = new StringWriter();
            XmlSerializer xml = Xml.newSerializer();
            xml.setOutput(output);
            xml.startDocument("UTF-8", true);
            xml.startTag("", "hierarchy");
            Display display = getContext().getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
            xml.attribute("", "rotation", Integer.toString(display == null ? 0 : display.getRotation()));
            writeNode(xml, root, 0, 0);
            xml.endTag("", "hierarchy");
            xml.endDocument();
            result.putString("xml", output.toString());
            finish(Activity.RESULT_OK, result);
        } catch (Exception error) {
            result.putString("error", error.toString());
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void captureRegion(UiAutomation automation, AccessibilityNodeInfo root, Bundle result)
            throws Exception {
        String packageName = text(root.getPackageName());
        if (!"com.playtimemobile".equals(packageName)) {
            throw new IllegalStateException("PlayTime must be the active window");
        }
        int left = Integer.parseInt(arguments.getString("left", "0"));
        int top = Integer.parseInt(arguments.getString("top", "0"));
        int width = Integer.parseInt(arguments.getString("width", "0"));
        int height = Integer.parseInt(arguments.getString("height", "0"));
        Bitmap screen = automation.takeScreenshot();
        if (screen == null) throw new IllegalStateException("Screenshot unavailable");
        Bitmap region = null;
        try {
            if (left < 0 || top < 0 || width < 1 || height < 1
                    || (long) left + width > screen.getWidth()
                    || (long) top + height > screen.getHeight()) {
                throw new IllegalArgumentException("Capture bounds exceed the real display");
            }
            region = Bitmap.createBitmap(screen, left, top, width, height);
            File output = new File(getContext().getCacheDir(), "playtime-window.png");
            try (FileOutputStream file = new FileOutputStream(output)) {
                if (!region.compress(Bitmap.CompressFormat.PNG, 100, file)) {
                    throw new IllegalStateException("PNG capture failed");
                }
            }
            result.putString("path", output.getAbsolutePath());
            result.putString("package", packageName);
            result.putString("bounds", new Rect(left, top, left + width, top + height).toShortString());
            result.putInt("width", width);
            result.putInt("height", height);
        } finally {
            if (region != null && region != screen) region.recycle();
            screen.recycle();
        }
    }

    private static String text(CharSequence value) {
        return value == null ? "" : value.toString().replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "");
    }

    private static void attribute(XmlSerializer xml, String name, boolean value) throws Exception {
        xml.attribute("", name, Boolean.toString(value));
    }

    private static void writeNode(XmlSerializer xml, AccessibilityNodeInfo node, int index, int depth) throws Exception {
        if (depth > 150) return;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        xml.startTag("", "node");
        xml.attribute("", "index", Integer.toString(index));
        xml.attribute("", "text", text(node.getText()));
        xml.attribute("", "resource-id", text(node.getViewIdResourceName()));
        xml.attribute("", "class", text(node.getClassName()));
        xml.attribute("", "package", text(node.getPackageName()));
        xml.attribute("", "content-desc", text(node.getContentDescription()));
        attribute(xml, "checkable", node.isCheckable());
        attribute(xml, "checked", node.isChecked());
        attribute(xml, "clickable", node.isClickable());
        attribute(xml, "enabled", node.isEnabled());
        attribute(xml, "focusable", node.isFocusable());
        attribute(xml, "focused", node.isFocused());
        attribute(xml, "scrollable", node.isScrollable());
        attribute(xml, "long-clickable", node.isLongClickable());
        attribute(xml, "password", node.isPassword());
        attribute(xml, "selected", node.isSelected());
        xml.attribute("", "bounds", "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]");
        for (int childIndex = 0; childIndex < node.getChildCount(); childIndex++) {
            AccessibilityNodeInfo child = node.getChild(childIndex);
            if (child != null && child.isVisibleToUser()) writeNode(xml, child, childIndex, depth + 1);
        }
        xml.endTag("", "node");
    }
}
