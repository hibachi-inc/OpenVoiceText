OSS_DIR = OpenVoiceText
PRO_BUILD_DIR = .build/arm64-apple-macosx/debug
APP_BUNDLE = .build/OpenVoiceText-Pro.app
PRO_SWIFT_FLAGS = -Xswiftc -DPROFEATURES

.PHONY: build bundle run clean

build:
	# Build OSS targets with PROFEATURES flag
	cd $(OSS_DIR) && swift build $(PRO_SWIFT_FLAGS)
	# Build Pro Refiner
	swift build

bundle: build
	# Assemble OSS .app bundle with PROFEATURES-enabled binaries
	rm -rf "$(APP_BUNDLE)"
	mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	cp "$(OSS_DIR)/.build/arm64-apple-macosx/debug/VoiceFlowApp" "$(APP_BUNDLE)/Contents/MacOS/VoiceFlowApp"
	cp "$(OSS_DIR)/Resources/Info.plist" "$(APP_BUNDLE)/Contents/"

	# STT XPC (unchanged)
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc/Contents/MacOS"
	cp "$(OSS_DIR)/.build/arm64-apple-macosx/debug/VoiceFlowSTT" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc/Contents/MacOS/VoiceFlowSTT"
	cp "$(OSS_DIR)/Resources/STT-Info.plist" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc/Contents/Info.plist"

	# Pro Refiner XPC (replaces OSS SimpleRefiner)
	mkdir -p "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/MacOS"
	cp "$(PRO_BUILD_DIR)/ProRefiner" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/MacOS/ProRefiner"
	cp "ProResources/Refiner-Info.plist" \
		"$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc/Contents/Info.plist"

	# Ad-hoc sign
	codesign --force --sign - "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.stt.xpc"
	codesign --force --sign - "$(APP_BUNDLE)/Contents/XPCServices/com.hibachi.voiceflow.refiner.xpc"
	codesign --force --sign - "$(APP_BUNDLE)"

run: bundle
	open "$(APP_BUNDLE)"

clean:
	swift package clean
	cd $(OSS_DIR) && swift package clean
	rm -rf "$(APP_BUNDLE)"
