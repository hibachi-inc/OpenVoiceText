OSS_DIR = OpenVoiceText
PRO_BUILD_DIR = .build/arm64-apple-macosx/debug
PRO_RELEASE_DIR = .build/arm64-apple-macosx/release
APP_BUNDLE = .build/VoiceLatte.app
MAS_BUNDLE = .build/mas/VoiceLatte.app
MAS_PKG = .build/VoiceLatte.pkg
PRO_SWIFT_FLAGS = -Xswiftc -DPROFEATURES
DIRECT_FLAGS = -Xswiftc -DDIRECT
EMBED_PLIST = -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Resources/Info.plist
DEV_SIGN = Developer ID Application: HIBACHI inc. (TYX92DB6TA)
MAS_SIGN_APP = 3rd Party Mac Developer Application: HIBACHI inc. (TYX92DB6TA)
MAS_SIGN_INST = 3rd Party Mac Developer Installer: HIBACHI inc. (TYX92DB6TA)

# Sparkle auto-update (DMG only)
SPARKLE_VERSION = 2.9.2
SPARKLE_DIR = .build/Sparkle
SPARKLE_FRAMEWORK = $(SPARKLE_DIR)/Sparkle.framework
SPARKLE_FLAGS = -Xswiftc -F$(CURDIR)/$(SPARKLE_DIR) \
    -Xlinker -F$(CURDIR)/$(SPARKLE_DIR) \
    -Xlinker -rpath -Xlinker @executable_path/../Frameworks

.PHONY: build build-mas bundle bundle-mas run run-mas mas upload clean clean-sparkle sparkle sparkle-keys appcast

PRO_INJECT = $(OSS_DIR)/Sources/VoiceFlowApp/Store/ProUpgradeManager.swift \
             $(OSS_DIR)/Sources/VoiceFlowApp/UI/MainWindow/ProUpgradeView.swift

# --- Sparkle ---

sparkle: $(SPARKLE_FRAMEWORK)

$(SPARKLE_FRAMEWORK):
	mkdir -p $(SPARKLE_DIR)
	curl -L -o $(SPARKLE_DIR)/Sparkle-$(SPARKLE_VERSION).tar.xz \
		https://github.com/sparkle-project/Sparkle/releases/download/$(SPARKLE_VERSION)/Sparkle-$(SPARKLE_VERSION).tar.xz
	tar -xf $(SPARKLE_DIR)/Sparkle-$(SPARKLE_VERSION).tar.xz -C $(SPARKLE_DIR)
	xattr -cr $(SPARKLE_FRAMEWORK)
	@echo "=== Sparkle $(SPARKLE_VERSION) ready ==="

sparkle-keys:
	$(SPARKLE_DIR)/bin/generate_keys

# --- Debug (dev) ---

build: sparkle
	cp Sources/ProApp/ProUpgradeManager.swift $(OSS_DIR)/Sources/VoiceFlowApp/Store/
	cp Sources/ProApp/ProUpgradeView.swift $(OSS_DIR)/Sources/VoiceFlowApp/UI/MainWindow/
	cd $(OSS_DIR) && swift build $(PRO_SWIFT_FLAGS) $(DIRECT_FLAGS) $(SPARKLE_FLAGS) || { rm -f $(PRO_INJECT); exit 1; }
	rm -f $(PRO_INJECT)
	swift build

bundle: build
	rm -rf "$(APP_BUNDLE)"
	mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	cp "$(OSS_DIR)/.build/arm64-apple-macosx/debug/VoiceFlowApp" "$(APP_BUNDLE)/Contents/MacOS/VoiceFlowApp"
	cp "ProResources/Info.plist" "$(APP_BUNDLE)/Contents/"
	mkdir -p "$(APP_BUNDLE)/Contents/Resources"
	cp "$(OSS_DIR)/Resources/AppIcon.icns" "$(APP_BUNDLE)/Contents/Resources/"
	cp "$(OSS_DIR)/Resources/PrivacyInfo.xcprivacy" "$(APP_BUNDLE)/Contents/Resources/"
	cp -R "$(OSS_DIR)/Resources/en.lproj" "$(APP_BUNDLE)/Contents/Resources/"
	cp -R "$(OSS_DIR)/Resources/ja.lproj" "$(APP_BUNDLE)/Contents/Resources/"
	# Sparkle framework (DMG only)
	mkdir -p "$(APP_BUNDLE)/Contents/Frameworks"
	cp -R "$(SPARKLE_FRAMEWORK)" "$(APP_BUNDLE)/Contents/Frameworks/"
	# XPC Services
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.stt.xpc/Contents/MacOS"
	cp "$(OSS_DIR)/.build/arm64-apple-macosx/debug/VoiceFlowSTT" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.stt.xpc/Contents/MacOS/VoiceFlowSTT"
	cp "ProResources/STT-Info.plist" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.stt.xpc/Contents/Info.plist"
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.refiner.xpc/Contents/MacOS"
	cp "$(PRO_BUILD_DIR)/ProRefiner" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.refiner.xpc/Contents/MacOS/ProRefiner"
	cp "ProResources/Refiner-Info.plist" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.refiner.xpc/Contents/Info.plist"
	# Codesign (inner → outer)
	# 1. App XPC services
	codesign --force --sign "$(DEV_SIGN)" \
		--entitlements "$(OSS_DIR)/Resources/Entitlements/STT-XPC-DMG.entitlements" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.stt.xpc"
	codesign --force --sign "$(DEV_SIGN)" \
		--entitlements "$(OSS_DIR)/Resources/Entitlements/Refiner-XPC.entitlements" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.refiner.xpc"
	# 2. Sparkle internal components (inner → outer)
	codesign --force --sign "$(DEV_SIGN)" \
		"$(APP_BUNDLE)/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Downloader.xpc"
	codesign --force --sign "$(DEV_SIGN)" \
		"$(APP_BUNDLE)/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc"
	codesign --force --sign "$(DEV_SIGN)" \
		"$(APP_BUNDLE)/Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate"
	codesign --force --sign "$(DEV_SIGN)" \
		"$(APP_BUNDLE)/Contents/Frameworks/Sparkle.framework"
	# 3. App bundle (outermost)
	codesign --force --sign "$(DEV_SIGN)" \
		--entitlements "$(OSS_DIR)/Resources/Entitlements/App-DMG.entitlements" \
		"$(APP_BUNDLE)"

run: bundle
	pkill -9 -f VoiceFlowApp 2>/dev/null || true
	pkill -9 -f VoiceLatte 2>/dev/null || true
	sleep 0.5
	open "$(APP_BUNDLE)"

# --- MAS Release (no Sparkle) ---

build-mas:
	cp Sources/ProApp/ProUpgradeManager.swift $(OSS_DIR)/Sources/VoiceFlowApp/Store/
	cp Sources/ProApp/ProUpgradeView.swift $(OSS_DIR)/Sources/VoiceFlowApp/UI/MainWindow/
	cd $(OSS_DIR) && swift build -c release $(PRO_SWIFT_FLAGS) $(EMBED_PLIST) \
		|| { rm -f $(PRO_INJECT); exit 1; }
	rm -f $(PRO_INJECT)
	swift build -c release

bundle-mas: build-mas
	rm -rf "$(MAS_BUNDLE)"
	mkdir -p "$(MAS_BUNDLE)/Contents/MacOS"
	cp "$(OSS_DIR)/.build/arm64-apple-macosx/release/VoiceFlowApp" "$(MAS_BUNDLE)/Contents/MacOS/VoiceFlowApp"
	cp "ProResources/Info.plist" "$(MAS_BUNDLE)/Contents/"
	# Strip Sparkle keys from MAS plist (App Store must not see these)
	/usr/libexec/PlistBuddy -c "Delete :SUFeedURL" "$(MAS_BUNDLE)/Contents/Info.plist" 2>/dev/null || true
	/usr/libexec/PlistBuddy -c "Delete :SUPublicEDKey" "$(MAS_BUNDLE)/Contents/Info.plist" 2>/dev/null || true
	mkdir -p "$(MAS_BUNDLE)/Contents/Resources"
	cp "$(OSS_DIR)/Resources/AppIcon.icns" "$(MAS_BUNDLE)/Contents/Resources/"
	cp "$(OSS_DIR)/Resources/PrivacyInfo.xcprivacy" "$(MAS_BUNDLE)/Contents/Resources/"
	cp -R "$(OSS_DIR)/Resources/en.lproj" "$(MAS_BUNDLE)/Contents/Resources/"
	cp -R "$(OSS_DIR)/Resources/ja.lproj" "$(MAS_BUNDLE)/Contents/Resources/"
	# Provisioning profile
	if [ -f ProResources/embedded.provisionprofile ]; then \
		cp ProResources/embedded.provisionprofile "$(MAS_BUNDLE)/Contents/"; \
	fi
	# STT XPC
	mkdir -p "$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.stt.xpc/Contents/MacOS"
	cp "$(OSS_DIR)/.build/arm64-apple-macosx/release/VoiceFlowSTT" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.stt.xpc/Contents/MacOS/VoiceFlowSTT"
	cp "ProResources/STT-Info.plist" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.stt.xpc/Contents/Info.plist"
	# Pro Refiner XPC
	mkdir -p "$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.refiner.xpc/Contents/MacOS"
	cp "$(PRO_RELEASE_DIR)/ProRefiner" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.refiner.xpc/Contents/MacOS/ProRefiner"
	cp "ProResources/Refiner-Info.plist" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.refiner.xpc/Contents/Info.plist"
	# Sign with MAS certificates (no Sparkle)
	codesign --force --sign "$(MAS_SIGN_APP)" \
		--entitlements "$(OSS_DIR)/Resources/Entitlements/STT-XPC.entitlements" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.stt.xpc"
	codesign --force --sign "$(MAS_SIGN_APP)" \
		--entitlements "$(OSS_DIR)/Resources/Entitlements/Refiner-XPC.entitlements" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.voicelatte.refiner.xpc"
	codesign --force --sign "$(MAS_SIGN_APP)" \
		--entitlements "$(OSS_DIR)/Resources/Entitlements/App-MAS.entitlements" \
		"$(MAS_BUNDLE)"

mas: bundle-mas
	rm -f "$(MAS_PKG)"
	productbuild --component "$(MAS_BUNDLE)" /Applications \
		--sign "$(MAS_SIGN_INST)" "$(MAS_PKG)"
	@echo "=== MAS pkg ready: $(MAS_PKG) ==="

upload: mas
	xcrun altool --upload-app -f "$(MAS_PKG)" -t macos --apiKey "$(ASC_API_KEY)" --apiIssuer "$(ASC_API_ISSUER)"

run-mas: bundle-mas
	pkill -9 -f VoiceFlowApp 2>/dev/null || true
	pkill -9 -f VoiceLatte 2>/dev/null || true
	sleep 0.5
	open "$(MAS_BUNDLE)"

# --- Appcast (run after release build) ---

appcast:
	mkdir -p .build/releases
	$(SPARKLE_DIR)/bin/generate_appcast .build/releases/
	@echo "=== appcast.xml updated ==="

# --- Clean ---

clean:
	swift package clean
	cd $(OSS_DIR) && swift package clean
	rm -rf "$(APP_BUNDLE)" "$(MAS_BUNDLE)" "$(MAS_PKG)"
	rm -f $(PRO_INJECT)

clean-sparkle:
	rm -rf $(SPARKLE_DIR)
