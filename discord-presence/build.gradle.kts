plugins {
    kotlin("jvm") version "2.2.10"
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // 运行时由宿主提供，不打进插件
    compileOnly(files("libs/plugin-api-1.3.jar"))
    compileOnly("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")

    testImplementation(kotlin("test"))
    testImplementation(files("libs/plugin-api-1.3.jar"))
}

tasks.test {
    useJUnitPlatform()
}

tasks.jar {
    archiveFileName.set("plugin.jar")
}

// 产物在 build/plugin，可直接在设置里导入
val packagePlugin by tasks.registering(Zip::class) {
    from(tasks.jar)
    from(layout.projectDirectory.file("plugin.json"))
    archiveFileName.set("discord-presence.melodiaplugin")
    destinationDirectory.set(layout.buildDirectory.dir("plugin"))
}
