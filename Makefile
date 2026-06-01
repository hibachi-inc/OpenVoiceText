OSS_DIR = OpenVoiceText
PRO_BUILD_DIR = .build/arm64-apple-macosx/debug
PRO_RELEASE_DIR = .build/arm64-apple-macosx/release
APP_BUNDLE = .build/Koeri.app
MAS_BUNDLE = .build/mas/Koeri.app
MAS_PKG = .build/Koeri.pkg
PRO_SWIFT_FLAGS = -Xswiftc -DPROFEATURES
EMBED_PLIST = -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Resources/Info.plist
MAS_SIGN_APP = 3rd Party Mac Developer Application: HIBACHI inc. (TYX92DB6TA)
MAS_SIGN_INST = 3rd Party Mac Developer Installer: HIBACHI inc. (TYX92DB6TA)

.PHONY: build build-mas bundle bundle-mas run run-mas mas upload clean

PRO_INJECT = $(OSS_DIR)/Sources/VoiceFlowApp/Store/ProUpgradeManager.swift \
             $(OSS_DIR)/Sources/VoiceFlowApp/UI/MainWindow/ProUpgradeView.swift

# --- Debug (dev) ---

build:
	cp Sources/ProApp/ProUpgradeManager.swift $(OSS_DIR)/Sources/VoiceFlowApp/Store/
	cp Sources/ProApp/ProUpgradeView.swift $(OSS_DIR)/Sources/VoiceFlowApp/UI/MainWindow/
	cd $(OSS_DIR) && swift build $(PRO_SWIFT_FLAGS) || { rm -f $(PRO_INJECT); exit 1; }
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
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.stt.xpc/Contents/MacOS"
	cp "$(OSS_DIR)/.build/arm64-apple-macosx/debug/VoiceFlowSTT" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.stt.xpc/Contents/MacOS/VoiceFlowSTT"
	cp "ProResources/STT-Info.plist" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.stt.xpc/Contents/Info.plist"
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.refiner.xpc/Contents/MacOS"
	cp "$(PRO_BUILD_DIR)/ProRefiner" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.refiner.xpc/Contents/MacOS/ProRefiner"
	cp "ProResources/Refiner-Info.plist" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.refiner.xpc/Contents/Info.plist"
	codesign --force --sign - "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.stt.xpc"
	codesign --force --sign - "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.refiner.xpc"
	codesign --force --sign - "$(APP_BUNDLE)"

run: bundle
	open "$(APP_BUNDLE)"

# --- MAS Release ---

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
	mkdir -p "$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.stt.xpc/Contents/MacOS"
	cp "$(OSS_DIR)/.build/arm64-apple-macosx/release/VoiceFlowSTT" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.stt.xpc/Contents/MacOS/VoiceFlowSTT"
	cp "ProResources/STT-Info.plist" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.stt.xpc/Contents/Info.plist"
	# Pro Refiner XPC
	mkdir -p "$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.refiner.xpc/Contents/MacOS"
	cp "$(PRO_RELEASE_DIR)/ProRefiner" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.refiner.xpc/Contents/MacOS/ProRefiner"
	cp "ProResources/Refiner-Info.plist" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.refiner.xpc/Contents/Info.plist"
	# Sign with MAS certificates
	codesign --force --sign "$(MAS_SIGN_APP)" \
		--entitlements "$(OSS_DIR)/Resources/Entitlements/STT-XPC.entitlements" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.stt.xpc"
	codesign --force --sign "$(MAS_SIGN_APP)" \
		--entitlements "$(OSS_DIR)/Resources/Entitlements/Refiner-XPC.entitlements" \
		"$(MAS_BUNDLE)/Contents/XPCServices/com.hibachi.koeri.refiner.xpc"
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
	open "$(MAS_BUNDLE)"

clean:
	swift package clean
	cd $(OSS_DIR) && swift package clean
	rm -rf "$(APP_BUNDLE)" "$(MAS_BUNDLE)" "$(MAS_PKG)"
	rm -f $(PRO_INJECT)
